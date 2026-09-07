import { Location, Maneuver, Route3DHighlight, RouteCoord } from '../types';

export type ManeuverCueRole = 'current' | 'next' | 'following';

export interface ManeuverCueStage {
  role: ManeuverCueRole;
  maneuver: Maneuver;
  maneuverIndex: number;
  distanceFromDriverMeters: number;
  strength: number;
}

export interface MultiManeuverChoreographyPlan {
  current: ManeuverCueStage | null;
  next: ManeuverCueStage | null;
  following: ManeuverCueStage | null;
  nextApproachStartIndex: number | null;
  nextApproachEndIndex: number | null;
  followingPreviewIndex: number | null;
}

function distance(a: Location, b: Location): number {
  return Math.hypot(
    (b.lat - a.lat) * 110540,
    (b.lng - a.lng) * 111320 * Math.max(0.2, Math.cos(a.lat * Math.PI / 180)),
  );
}

function routeDistance(coords: RouteCoord[], start: number, end: number): number {
  let total = 0;
  const step = start <= end ? 1 : -1;
  for (let i = start; i !== end; i += step) {
    const next = i + step;
    if (!coords[next]) break;
    total += distance(coords[i], coords[next]);
  }
  return total;
}

function nearestIndex(coords: RouteCoord[], point: Location): number {
  let bestIndex = 0;
  let best = Number.POSITIVE_INFINITY;
  coords.forEach((candidate, index) => {
    const d = distance(candidate, point);
    if (d < best) { best = d; bestIndex = index; }
  });
  return bestIndex;
}

function indexAtDistance(coords: RouteCoord[], anchor: number, meters: number, direction: 1 | -1): number {
  let index = anchor;
  let travelled = 0;
  while (index + direction >= 0 && index + direction < coords.length && travelled < meters) {
    travelled += distance(coords[index], coords[index + direction]);
    index += direction;
  }
  return index;
}

/**
 * Gives the renderer a single priority order for the three maneuvers visible
 * ahead of the driver. The current maneuver owns the near field, the next
 * maneuver gets a bounded preparation window, and the following maneuver is
 * only a weak preview when there is enough road between decisions.
 */
export function buildMultiManeuverChoreography(
  route: Route3DHighlight,
  currentManeuver: Maneuver,
  userLocation: RouteCoord | null = null,
): MultiManeuverChoreographyPlan | null {
  const coords = route.segments.flatMap((segment) => segment.coords);
  const maneuvers = route.maneuvers ?? [];
  if (coords.length < 2 || maneuvers.length === 0) return null;

  const currentIndex = nearestIndex(coords, currentManeuver.location);
  const driverIndex = userLocation ? nearestIndex(coords, userLocation) : currentIndex;
  const ordered = maneuvers
    .map((maneuver, index) => ({ maneuver, index, routeIndex: nearestIndex(coords, maneuver.location) }))
    .filter((item) => item.routeIndex >= driverIndex - 2)
    .sort((a, b) => a.routeIndex - b.routeIndex);

  const current = ordered.find((item) => Math.abs(item.routeIndex - currentIndex) <= 3)
    ?? { maneuver: currentManeuver, index: -1, routeIndex: currentIndex };
  const future = ordered.filter((item) => item.routeIndex > current.routeIndex + 2);
  const next = future[0] ?? null;
  const following = future[1] ?? null;

  const makeStage = (role: ManeuverCueRole, item: typeof current, strength: number): ManeuverCueStage => ({
    role,
    maneuver: item.maneuver,
    maneuverIndex: item.routeIndex,
    distanceFromDriverMeters: routeDistance(coords, driverIndex, item.routeIndex),
    strength,
  });

  const nextStage = next ? makeStage('next', next, next.maneuver.is_complex ? 0.36 : 0.22) : null;
  const followingDistance = following ? routeDistance(coords, next?.routeIndex ?? currentIndex, following.routeIndex) : 0;
  const followingStage = following && followingDistance >= 85
    ? makeStage('following', following, following.maneuver.is_complex ? 0.10 : 0.06)
    : null;

  const currentStage = currentManeuver
    ? makeStage('current', current, 1)
    : null;

  if (!nextStage) {
    return { current: currentStage, next: null, following: null, nextApproachStartIndex: null, nextApproachEndIndex: null, followingPreviewIndex: null };
  }

  // A closely spaced following maneuver compresses the next preparation zone;
  // otherwise the next maneuver can claim a longer, quieter lead-in.
  const gap = routeDistance(coords, current.routeIndex, next.routeIndex);
  const followingBuffer = following ? Math.min(45, followingDistance * 0.28) : 0;
  const approachCap = following ? Math.max(20, Math.min(95, followingDistance * 0.05)) : 95;
  const approachLength = Math.max(20, Math.min(approachCap, gap * 0.32, Math.max(20, gap - followingBuffer)));
  const approachEnd = indexAtDistance(coords, next.routeIndex, following ? Math.min(58, followingDistance * 0.48) : 55, -1);
  const approachStart = indexAtDistance(coords, approachEnd, approachLength, -1);

  return {
    current: currentStage,
    next: nextStage,
    following: followingStage,
    nextApproachStartIndex: Math.max(driverIndex, approachStart),
    nextApproachEndIndex: Math.max(driverIndex, approachEnd),
    followingPreviewIndex: followingStage ? indexAtDistance(coords, followingStage.maneuverIndex, 28, -1) : null,
  };
}
