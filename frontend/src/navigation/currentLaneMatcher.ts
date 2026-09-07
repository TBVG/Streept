import { Location, SceneRoad } from '../types';
import { bearingDegrees } from '../utils/geo';
import { DriverLaneEstimate, estimateDriverLane } from './laneIntelligence';

export interface CurrentLaneMatch extends DriverLaneEstimate {
  distanceMeters: number;
  physicalDistanceMeters: number;
  headingErrorDegrees: number | null;
  wayId: number | null;
  travelDirection: 'forward' | 'reverse' | 'unknown';
  segmentIndex: number;
  segmentProgress: number;
}

interface ProjectedSegment {
  index: number;
  progress: number;
  distance: number;
  lateral: number;
  projected: Location;
}

function localMeters(point: Location, origin: Location): { x: number; y: number } {
  const latScale = 110540;
  const lngScale = 111320 * Math.max(0.2, Math.cos(origin.lat * Math.PI / 180));
  return {
    x: (point.lng - origin.lng) * lngScale,
    y: (point.lat - origin.lat) * latScale,
  };
}

/** True point-to-segment projection in a local equirectangular frame. */
function projectOntoSegment(point: Location, a: Location, b: Location): { progress: number; distance: number; lateral: number; projected: Location } {
  const p = localMeters(point, a);
  const end = localMeters(b, a);
  const lengthSquared = end.x * end.x + end.y * end.y;
  const raw = lengthSquared > 0 ? (p.x * end.x + p.y * end.y) / lengthSquared : 0;
  const progress = Math.max(0, Math.min(1, raw));
  const x = end.x * progress;
  const y = end.y * progress;
  const dx = p.x - x;
  const dy = p.y - y;
  const distance = Math.hypot(dx, dy);
  // Cross product sign: positive is left of the segment direction.
  const lateral = lengthSquared > 0 ? (end.x * p.y - end.y * p.x) / Math.sqrt(lengthSquared) : 0;
  return {
    progress,
    distance,
    lateral,
    projected: { lat: a.lat + (b.lat - a.lat) * progress, lng: a.lng + (b.lng - a.lng) * progress },
  };
}

function closestSegment(point: Location, road: SceneRoad): ProjectedSegment | null {
  if (road.geometry.length < 2) return null;
  let best: ProjectedSegment | null = null;
  for (let i = 0; i < road.geometry.length - 1; i += 1) {
    const a = road.geometry[i];
    const b = road.geometry[i + 1];
    const projection = projectOntoSegment(point, a, b);
    if (!best || projection.distance < best.distance) {
      best = { index: i, ...projection };
    }
  }
  return best;
}

function directionForRoad(road: SceneRoad, segmentIndex: number, heading: number | null): 'forward' | 'reverse' | 'unknown' {
  if (road.oneway_reverse) return 'reverse';
  if (road.oneway) return 'forward';
  if (heading == null) return 'unknown';
  const a = road.geometry[segmentIndex]; const b = road.geometry[segmentIndex + 1];
  if (!a || !b) return 'unknown';
  const forward = bearingDegrees(a, b);
  const reverse = (forward + 180) % 360;
  const diff = (x: number, y: number) => Math.abs(((x - y + 540) % 360) - 180);
  return diff(heading, forward) <= diff(heading, reverse) ? 'forward' : 'reverse';
}

/** Match a GPS fix to a physical OSM carriageway lane using true segment
 * projection. Lane numbering is canonicalized into the driver's travel
 * direction, including reverse one-way carriageways. */
export function matchCurrentLane(
  point: Location,
  roads: SceneRoad[],
  heading: number | null = null,
  preferredWayId: number | null = null,
  maxDistanceMeters = 35,
): CurrentLaneMatch | null {
  let best: CurrentLaneMatch | null = null;
  for (const road of roads) {
    if (road.geometry.length < 2) continue;
    if (preferredWayId != null && road.osm_id !== preferredWayId) continue;
    const segment = closestSegment(point, road);
    if (!segment || segment.distance > maxDistanceMeters) continue;
    const a = road.geometry[segment.index]; const b = road.geometry[segment.index + 1];
    const direction = directionForRoad(road, segment.index, heading);
    const forwardBearing = bearingDegrees(a, b);
    const travelBearing = direction === 'reverse' ? (forwardBearing + 180) % 360 : forwardBearing;
    const headingPenalty = heading == null ? 0 : Math.abs(((heading - travelBearing + 540) % 360) - 180) / 180;
    const laneCount = Math.max(1, Math.min(8, road.lanes ?? 1));
    const roadWidth = Math.max(5.5, Math.min(24, laneCount * 3.3));
    let lateral = segment.lateral;
    if (direction === 'reverse') lateral *= -1;
    const estimate = estimateDriverLane(lateral, laneCount, roadWidth);
    const score = segment.distance + headingPenalty * 12 + (preferredWayId != null && road.osm_id === preferredWayId ? -8 : 0);
    const confidence = Math.max(0, Math.min(1, estimate.confidence * (1 - Math.min(0.35, segment.distance / maxDistanceMeters * 0.35)) * (1 - headingPenalty * 0.35)));
    if (!best || score < best.distanceMeters) {
      best = {
        ...estimate,
        confidence,
        wayId: road.osm_id ?? null,
        travelDirection: direction,
        distanceMeters: score,
        physicalDistanceMeters: segment.distance,
        headingErrorDegrees: heading == null ? null : headingPenalty * 180,
        segmentIndex: segment.index,
        segmentProgress: segment.progress,
      };
    }
  }
  return best;
}

export function projectLaneMatch(point: Location, road: SceneRoad): { segmentIndex: number; progress: number; distanceMeters: number; projected: Location } | null {
  const segment = closestSegment(point, road);
  if (!segment) return null;
  return { segmentIndex: segment.index, progress: segment.progress, distanceMeters: segment.distance, projected: segment.projected };
}

export function laneMatchDistanceToRoad(point: Location, road: SceneRoad): number {
  const segment = closestSegment(point, road);
  return segment?.distance ?? Number.POSITIVE_INFINITY;
}
