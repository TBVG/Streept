import { Location, SceneRoad } from '../types';

export type SceneTravelDirection = 'forward' | 'reverse' | 'unknown';

export interface SceneWayMatch {
  wayId: number;
  distanceMeters: number;
  segmentIndex: number;
  progressMeters: number;
  confidence: number;
  travelDirection: SceneTravelDirection;
}

function distanceMeters(a: Location, b: Location): number {
  const latScale = 110540;
  const lngScale = 111320 * Math.max(0.2, Math.cos(a.lat * Math.PI / 180));
  return Math.hypot((a.lat - b.lat) * latScale, (a.lng - b.lng) * lngScale);
}

function bearingDegrees(a: Location, b: Location): number {
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angularDifference(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function project(point: Location, a: Location, b: Location): { point: Location; t: number; distanceMeters: number } {
  const latScale = 110540;
  const lngScale = 111320 * Math.max(0.2, Math.cos(point.lat * Math.PI / 180));
  const ax = a.lng * lngScale; const ay = a.lat * latScale;
  const bx = b.lng * lngScale; const by = b.lat * latScale;
  const px = point.lng * lngScale; const py = point.lat * latScale;
  const dx = bx - ax; const dy = by - ay;
  const denom = dx * dx + dy * dy;
  const t = denom > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom)) : 0;
  const snapped = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  return { point: snapped, t, distanceMeters: distanceMeters(point, snapped) };
}

function segmentDirection(road: SceneRoad, a: Location, b: Location, headingDegrees?: number | null): SceneTravelDirection {
  if (road.oneway) return road.oneway_reverse ? 'reverse' : 'forward';
  if (headingDegrees == null || !Number.isFinite(headingDegrees)) return 'unknown';
  const forwardError = angularDifference(headingDegrees, bearingDegrees(a, b));
  const reverseError = angularDifference(headingDegrees, bearingDegrees(b, a));
  return forwardError <= reverseError ? 'forward' : 'reverse';
}

/** Match a GPS point to actual OSM way segments while respecting one-way
 * direction and, when available, the vehicle heading. The matcher returns
 * direction so downstream restriction logic can distinguish opposite
 * carriageway traversal even when both ways overlap spatially. */
export function matchSceneWay(
  point: Location,
  roads: SceneRoad[],
  previousWayId: number | null = null,
  maxDistanceMeters = 70,
  headingDegreesInput: number | null = null,
): SceneWayMatch | null {
  let best: SceneWayMatch | null = null;
  for (const road of roads) {
    if (road.osm_id == null || road.geometry.length < 2) continue;
    let progress = 0;
    for (let i = 0; i < road.geometry.length - 1; i += 1) {
      const a = road.geometry[i]; const b = road.geometry[i + 1];
      const segmentLength = distanceMeters(a, b);
      if (segmentLength < 0.01) continue;
      const p = project(point, a, b);
      const direction = segmentDirection(road, a, b, headingDegreesInput);
      const continuityPenalty = previousWayId === road.osm_id ? 0.75 : 0;
      const headingPenalty = headingDegreesInput != null && direction !== 'unknown' ?
        angularDifference(headingDegreesInput, direction === 'forward' ? bearingDegrees(a, b) : bearingDegrees(b, a)) / 180 * 10 : 0;
      const score = p.distanceMeters + headingPenalty + continuityPenalty;
      const bestScore = best ? best.distanceMeters : Number.POSITIVE_INFINITY;
      if (!best || score < bestScore) {
        best = {
          wayId: road.osm_id,
          distanceMeters: score,
          segmentIndex: i,
          progressMeters: progress + segmentLength * p.t,
          confidence: Math.max(0, Math.min(1, 1 - p.distanceMeters / maxDistanceMeters)),
          travelDirection: direction,
        };
      }
      progress += segmentLength;
    }
  }
  if (!best || best.distanceMeters > maxDistanceMeters) return null;
  return best;
}

/** Match route samples to way segments and collapse consecutive duplicates.
 * Heading is derived from adjacent route samples so one-way/reverse carriageway
 * identity follows the actual route direction instead of arbitrary geometry order. */
export function deriveSegmentSceneWaySequence(
  routePoints: Location[],
  roads: SceneRoad[],
  maxDistanceMeters = 45,
): number[] {
  const result: number[] = [];
  let previous: number | null = null;
  for (let i = 0; i < routePoints.length; i += 1) {
    const point = routePoints[i];
    const next = routePoints[i + 1] ?? routePoints[i - 1];
    const heading = next && next !== point ? bearingDegrees(point, next) : null;
    const match = matchSceneWay(point, roads, previous, maxDistanceMeters, heading);
    if (!match) continue;
    previous = match.wayId;
    if (result[result.length - 1] !== match.wayId) result.push(match.wayId);
  }
  return result;
}
