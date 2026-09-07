import { Location, Maneuver, Route3DHighlight, RouteCoord } from '../types';
import { bearingDegrees, destinationPoint } from '../utils/geo';

export interface RouteAheadContinuityPlan {
  startIndex: number;
  endIndex: number;
  nextManeuverIndex: number | null;
  nextManeuver: Maneuver | null;
  fadeInMeters: number;
  fadeOutMeters: number;
  emphasis: number;
}

function pointDistance(a: Location, b: Location): number {
  return Math.hypot(
    (b.lat - a.lat) * 110540,
    (b.lng - a.lng) * 111320 * Math.max(0.2, Math.cos(a.lat * Math.PI / 180)),
  );
}

function nearestIndex(coords: RouteCoord[], point: Location): number {
  let bestIndex = 0;
  let best = Number.POSITIVE_INFINITY;
  coords.forEach((candidate, index) => {
    const distance = pointDistance(candidate, point);
    if (distance < best) { best = distance; bestIndex = index; }
  });
  return bestIndex;
}

function advanceByMeters(coords: RouteCoord[], anchor: number, meters: number, direction: 1 | -1): number {
  let index = anchor;
  let travelled = 0;
  while (index + direction >= 0 && index + direction < coords.length && travelled < meters) {
    travelled += pointDistance(coords[index], coords[index + direction]);
    index += direction;
  }
  return index;
}

/**
 * Plans only a short visual bridge between the current junction and the next
 * maneuver. It deliberately stops before the next decision zone so the next
 * maneuver can take over with a stronger visual language.
 */
export function buildRouteAheadContinuityPlan(
  route: Route3DHighlight,
  currentManeuver: Maneuver,
  userLocation: RouteCoord | null = null,
): RouteAheadContinuityPlan | null {
  const coords = route.segments.flatMap((segment) => segment.coords);
  const maneuvers = route.maneuvers ?? [];
  if (coords.length < 2 || maneuvers.length === 0) return null;

  const currentIndex = nearestIndex(coords, currentManeuver.location);
  const nextCandidates = maneuvers
    .map((maneuver, index) => ({ maneuver, index, routeIndex: nearestIndex(coords, maneuver.location) }))
    .filter((candidate) => candidate.routeIndex > currentIndex + 2)
    .sort((a, b) => a.routeIndex - b.routeIndex);
  const next = nextCandidates[0] ?? null;
  if (!next) return null;

  const userIndex = userLocation ? nearestIndex(coords, userLocation) : currentIndex;
  const startIndex = Math.max(userIndex, currentIndex);
  const endIndex = advanceByMeters(coords, next.routeIndex, 55, -1);
  if (endIndex <= startIndex + 1) return null;

  return {
    startIndex,
    endIndex: Math.min(coords.length - 1, endIndex),
    nextManeuverIndex: next.routeIndex,
    nextManeuver: next.maneuver,
    fadeInMeters: 45,
    fadeOutMeters: 55,
    emphasis: next.maneuver.is_complex ? 0.22 : 0.14,
  };
}

export function continuityLanePolygon(
  coords: RouteCoord[],
  plan: RouteAheadContinuityPlan,
  laneIndex: number,
  laneCount: number,
  roadWidthMeters: number,
): RouteCoord[] {
  const left: RouteCoord[] = [];
  const right: RouteCoord[] = [];
  const halfLane = Math.max(1.15, Math.min(1.55, roadWidthMeters / Math.max(2, laneCount * 2)));
  const centerOffset = -roadWidthMeters / 2 + roadWidthMeters * (laneIndex + 0.5) / Math.max(1, laneCount);
  for (let i = plan.startIndex; i <= plan.endIndex; i += 1) {
    const point = coords[i];
    const next = coords[Math.min(i + 1, coords.length - 1)];
    const bearing = bearingDegrees(point, next);
    left.push(destinationPoint(point, (bearing + 90) % 360, centerOffset - halfLane));
    right.push(destinationPoint(point, (bearing + 90) % 360, centerOffset + halfLane));
  }
  return [...left, ...right.reverse()];
}
