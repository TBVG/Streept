import { Location, Maneuver, Report, Route3DHighlight, SceneContext, SceneRoad } from '../types';
import { haversineDistanceMeters, projectOntoPolyline } from '../utils/geo';
import { deriveSpatialLaneIntelligence, SpatialLaneIntelligence } from './spatialLaneIntelligence';
import { deriveSpatialHazardIntelligence, SpatialHazardIntelligence } from './spatialHazardIntelligence';
import { deriveIntersectionIntelligence, IntersectionIntelligence } from './intersectionIntelligence';

export type SpatialRoadClass = 'local' | 'arterial' | 'highway' | 'unknown';
export type SpatialManeuverContext = 'none' | 'turn' | 'merge' | 'roundabout' | 'fork' | 'ramp' | 'complex';

export interface SpatialIntelligenceSnapshot {
  roadClass: SpatialRoadClass;
  roadName: string | null;
  wayId: number | null;
  laneCount: number | null;
  oneWay: boolean | null;
  speedLimitKph: number | null;
  maneuver: SpatialManeuverContext;
  maneuverDistanceMeters: number | null;
  nextManeuver: Maneuver | null;
  nearbySignals: number;
  nearbyCrossings: number;
  nearbyStops: number;
  nearbyReports: number;
  nearbyTrafficVehicles: number;
  hazardIntelligence: SpatialHazardIntelligence;
  laneIntelligence: SpatialLaneIntelligence;
  intersectionIntelligence: IntersectionIntelligence;
  confidence: number;
}

const HIGHWAYS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
const ARTERIALS = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);

function classifyRoad(highway: string | null | undefined): SpatialRoadClass {
  if (!highway) return 'unknown';
  if (HIGHWAYS.has(highway)) return 'highway';
  if (ARTERIALS.has(highway)) return 'arterial';
  return 'local';
}

function parseSpeed(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /mph/i.test(value) ? n * 1.609344 : n;
}

function nearestRoad(location: Location, roads: SceneRoad[]): { road: SceneRoad; distance: number } | null {
  let best: { road: SceneRoad; distance: number } | null = null;
  for (const road of roads) {
    for (const point of road.geometry) {
      const distance = haversineDistanceMeters(location, point);
      if (!best || distance < best.distance) best = { road, distance };
    }
  }
  return best;
}

function routePolyline(route: Route3DHighlight): Location[] {
  return route.segments.flatMap((segment) => segment.coords.map((coord) => ({ lat: coord.lat, lng: coord.lng })));
}

/**
 * Finds the next maneuver in route order rather than simply choosing the
 * geographically closest maneuver. A passed maneuver can be physically close
 * to the vehicle (especially at a hairpin, roundabout, or parallel road), but
 * it must never become the active upcoming instruction again.
 */
function nextRouteManeuver(route: Route3DHighlight | null, location: Location): { maneuver: Maneuver; distance: number } | null {
  if (!route?.maneuvers?.length) return null;
  const polyline = routePolyline(route);
  const currentProjection = projectOntoPolyline(location, polyline);

  if (currentProjection) {
    const candidates = route.maneuvers
      .map((maneuver, index) => {
        const projection = projectOntoPolyline(maneuver.location, polyline);
        return projection
          ? { maneuver, index, along: projection.distanceAlongMeters, distance: projection.distanceAlongMeters - currentProjection.distanceAlongMeters }
          : null;
      })
      .filter((candidate): candidate is { maneuver: Maneuver; index: number; along: number; distance: number } => candidate !== null)
      .filter((candidate) => candidate.distance >= -18)
      .sort((a, b) => a.distance - b.distance || a.index - b.index);

    if (candidates.length > 0) {
      const next = candidates[0];
      return { maneuver: next.maneuver, distance: Math.max(0, next.distance) };
    }
  }

  // If route projection is unavailable, retain a conservative spatial fallback.
  let best: { maneuver: Maneuver; distance: number } | null = null;
  for (const maneuver of route.maneuvers) {
    const distance = haversineDistanceMeters(location, maneuver.location);
    if (!best || distance < best.distance) best = { maneuver, distance };
  }
  return best;
}

function maneuverContext(maneuver: Maneuver | null): SpatialManeuverContext {
  if (!maneuver) return 'none';
  const type = maneuver.type.toLowerCase();
  if (type.includes('roundabout') || type.includes('rotary')) return 'roundabout';
  if (type.includes('merge')) return 'merge';
  if (type.includes('fork')) return 'fork';
  if (type.includes('ramp')) return 'ramp';
  if (maneuver.is_complex) return 'complex';
  return 'turn';
}

function countNearby(location: Location, points: Array<{ lat: number; lng: number }>, radiusMeters: number): number {
  return points.reduce((count, point) => count + (haversineDistanceMeters(location, point) <= radiusMeters ? 1 : 0), 0);
}

/**
 * Builds one renderer-independent description of the physical driving context.
 * It deliberately uses only evidence already present in the navigation session;
 * it does not invent map facts when scene data is unavailable.
 */
export function deriveSpatialIntelligence(
  location: Location | null,
  route: Route3DHighlight | null,
  scene: SceneContext | null,
  currentWayId: number | null,
  reports: Array<Pick<Report, 'location' | 'type' | 'confidence'>> = [],
  trafficVehicles: Array<{ location: Location }> = [],
  maneuverDistanceOverrideMeters: number | null = null,
  currentLaneIndex: number | null = null,
  plannedWaySequence: number[] = [],
): SpatialIntelligenceSnapshot {
  const fallback: SpatialIntelligenceSnapshot = {
    roadClass: 'unknown', roadName: null, wayId: currentWayId, laneCount: null, oneWay: null,
    speedLimitKph: null, maneuver: 'none', maneuverDistanceMeters: maneuverDistanceOverrideMeters,
    nextManeuver: null, nearbySignals: 0, nearbyCrossings: 0, nearbyStops: 0, nearbyReports: 0, nearbyTrafficVehicles: 0, hazardIntelligence: { level: 'none', nearbyCriticalReports: 0, nearbyTrafficJams: 0, nearbyClosedLanes: 0, confidence: 0 }, laneIntelligence: { currentLaneIndex: null, recommendedLaneIndices: [], laneAlignment: 'unknown', laneChangeDirection: 'unknown', requiredLaneChanges: 0, confidence: 0 }, intersectionIntelligence: deriveIntersectionIntelligence(null, null, null, maneuverDistanceOverrideMeters), confidence: 0,
  };
  if (!location) return fallback;

  const road = scene ? (currentWayId != null
    ? scene.roads.find((item) => item.osm_id === currentWayId) ?? null
    : nearestRoad(location, scene.roads)?.road ?? null) : null;
  const nearest = nextRouteManeuver(route, location);
  const maneuverDistanceMeters = maneuverDistanceOverrideMeters ?? nearest?.distance ?? null;
  const incomingRoad = road;
  const plannedRoadIndex = road?.osm_id != null ? plannedWaySequence.indexOf(road.osm_id) : -1;
  const plannedNextWayId = plannedRoadIndex >= 0 && plannedRoadIndex + 1 < plannedWaySequence.length
    ? plannedWaySequence[plannedRoadIndex + 1]
    : null;
  const outgoingRoad = nearest?.maneuver && scene
    ? (plannedNextWayId != null
      ? scene.roads.find((item) => item.osm_id === plannedNextWayId) ?? null
      : nearestRoad(nearest.maneuver.location, scene.roads.filter((item) => item.osm_id !== road?.osm_id))?.road ?? null)
    : null;
  const roadDistance = road ? Math.min(...road.geometry.map((point) => haversineDistanceMeters(location, point))) : Infinity;
  const roadEvidence = Number.isFinite(roadDistance) ? Math.max(0, 1 - roadDistance / 80) : 0;
  const maneuverEvidence = nearest ? Math.max(0, 1 - nearest.distance / 500) : 0;
  const sceneEvidence = scene ? 0.2 : 0;
  const confidence = Math.min(1, Math.max(0, roadEvidence * 0.55 + maneuverEvidence * 0.25 + sceneEvidence));

  return {
    roadClass: classifyRoad(road?.highway),
    roadName: road?.name ?? null,
    wayId: road?.osm_id ?? currentWayId,
    laneCount: road?.lanes ?? null,
    oneWay: road?.oneway ?? null,
    speedLimitKph: parseSpeed(road?.maxspeed),
    maneuver: maneuverContext(nearest?.maneuver ?? null),
    maneuverDistanceMeters,
    nextManeuver: nearest?.maneuver ?? null,
    nearbySignals: scene ? countNearby(location, scene.signals, 80) : 0,
    nearbyCrossings: scene ? countNearby(location, scene.crossings, 80) : 0,
    nearbyStops: scene ? countNearby(location, scene.stops, 100) : 0,
    nearbyReports: countNearby(location, reports.map((report) => report.location), 150),
    nearbyTrafficVehicles: countNearby(location, trafficVehicles.map((vehicle) => vehicle.location), 120),
    hazardIntelligence: deriveSpatialHazardIntelligence(
      reports,
      countNearby(location, trafficVehicles.map((vehicle) => vehicle.location), 120),
    ),
    laneIntelligence: deriveSpatialLaneIntelligence(road, nearest?.maneuver ?? null, currentLaneIndex),
    intersectionIntelligence: deriveIntersectionIntelligence(nearest?.maneuver ?? null, incomingRoad, outgoingRoad, maneuverDistanceMeters),
    confidence,
  };
}
