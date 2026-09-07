import { Location, Maneuver, Route3DHighlight, RouteCoord } from '../types';

export type ApproachTrafficMode = 'stopped' | 'slow' | 'cruising' | 'fast';

export interface PredictiveJunctionApproachPlan {
  distanceToManeuverMeters: number;
  speedMps: number;
  trafficMode: ApproachTrafficMode;
  preparationDistanceMeters: number;
  prominence: number;
  approachStartMetersAhead: number;
  decisionLeadMeters: number;
}

function distance(a: Location, b: Location): number {
  return Math.hypot(
    (b.lat - a.lat) * 110540,
    (b.lng - a.lng) * 111320 * Math.max(0.2, Math.cos(a.lat * Math.PI / 180)),
  );
}

function nearestIndex(coords: RouteCoord[], point: Location): number {
  let best = Number.POSITIVE_INFINITY;
  let index = 0;
  coords.forEach((candidate, i) => {
    const d = distance(candidate, point);
    if (d < best) { best = d; index = i; }
  });
  return index;
}

function routeDistance(coords: RouteCoord[], start: number, end: number): number {
  let total = 0;
  for (let i = Math.min(start, end); i < Math.max(start, end); i += 1) total += distance(coords[i], coords[i + 1]);
  return total;
}

/**
 * Converts physical distance + current speed into a stable visual approach
 * window. It intentionally does not use route point indices as the primary
 * trigger: GPS sampling density can change without changing driver intent.
 */
export function buildPredictiveJunctionApproach(
  route: Route3DHighlight,
  maneuver: Maneuver,
  userLocation: Location,
  speedMps: number | null,
): PredictiveJunctionApproachPlan | null {
  const coords = route.segments.flatMap((segment) => segment.coords);
  if (coords.length < 2) return null;
  const driverIndex = nearestIndex(coords, userLocation);
  const maneuverIndex = nearestIndex(coords, maneuver.location);
  const distanceToManeuverMeters = routeDistance(coords, driverIndex, maneuverIndex);
  const speed = Math.max(0, Number.isFinite(speedMps ?? NaN) ? speedMps ?? 0 : 0);
  const trafficMode: ApproachTrafficMode = speed < 1 ? 'stopped' : speed < 5 ? 'slow' : speed < 14 ? 'cruising' : 'fast';

  const complexMultiplier = maneuver.is_complex ? 1.28 : 1;
  // Longer lead time at speed, but bounded so the scene never lights up too
  // far ahead. Slow traffic gets more spatial runway because reaction time is
  // less about raw speed and more about maintaining readiness through queues.
  const reactionSeconds = trafficMode === 'fast' ? 6.5 : trafficMode === 'cruising' ? 5.5 : trafficMode === 'slow' ? 7.5 : 5;
  const speedDistance = speed * reactionSeconds;
  const baseDistance = maneuver.is_complex ? 72 : 42;
  const preparationDistanceMeters = Math.max(
    trafficMode === 'stopped' ? 30 : 38,
    Math.min(maneuver.is_complex ? 150 : 105, Math.max(baseDistance, speedDistance * complexMultiplier)),
  );
  const lead = Math.min(distanceToManeuverMeters, preparationDistanceMeters);
  const decisionLeadMeters = maneuver.is_complex ? Math.max(18, Math.min(34, 18 + speed * 0.35)) : Math.max(10, Math.min(22, 10 + speed * 0.2));
  const readiness = distanceToManeuverMeters <= 1 ? 1 : Math.max(0, Math.min(1, 1 - Math.max(0, distanceToManeuverMeters - decisionLeadMeters) / Math.max(1, preparationDistanceMeters)));
  const trafficBoost = trafficMode === 'fast' ? 0.10 : trafficMode === 'slow' ? 0.06 : trafficMode === 'stopped' ? 0.03 : 0;
  // Prominence must continue to distinguish an approach that is merely
  // route-ahead from one the driver is actually nearing. Readiness alone is
  // clamped to zero once outside the preparation window, which made very near
  // and very distant maneuvers collapse to the same base prominence.
  const indexGap = Math.abs(maneuverIndex - driverIndex);
  const proximity = Math.max(0, Math.min(1, 1 - distanceToManeuverMeters / Math.max(1, preparationDistanceMeters * 6)));
  const indexProximity = Math.max(0, Math.min(1, 1 - indexGap / 8));
  const prominence = Math.max(0.12, Math.min(1, (maneuver.is_complex ? 0.58 : 0.38) + Math.max(readiness, proximity * 0.55, indexProximity * 0.22) * (maneuver.is_complex ? 0.42 : 0.34) + trafficBoost));

  return {
    distanceToManeuverMeters,
    speedMps: speed,
    trafficMode,
    preparationDistanceMeters,
    prominence,
    approachStartMetersAhead: lead,
    decisionLeadMeters,
  };
}

export function predictiveApproachIndexDistance(plan: PredictiveJunctionApproachPlan): number {
  return Math.max(0, Math.min(plan.preparationDistanceMeters, plan.distanceToManeuverMeters));
}
