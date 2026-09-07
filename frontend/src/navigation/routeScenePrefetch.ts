import { Location, Maneuver, Route3DHighlight } from '../types';
import { sceneCacheKey } from './sceneStreaming';

export interface RouteScenePrefetchOptions {
  horizonMeters?: number;
  maxLocations?: number;
  spacingMeters?: number;
}

export interface RouteScenePrefetchPlan {
  locations: Location[];
  keys: string[];
  horizonMeters: number;
}

const DEFAULT_HORIZON_METERS = 900;
const DEFAULT_MAX_LOCATIONS = 8;
const DEFAULT_SPACING_METERS = 220;

const distanceMeters = (a: Location, b: Location): number => {
  const latScale = 111_320;
  const lngScale = latScale * Math.max(0.2, Math.cos(a.lat * Math.PI / 180));
  return Math.hypot((a.lat - b.lat) * latScale, (a.lng - b.lng) * lngScale);
};

const cumulativeDistances = (locations: Location[]): number[] => {
  const result = [0];
  for (let i = 1; i < locations.length; i += 1) {
    result.push(result[i - 1] + distanceMeters(locations[i - 1], locations[i]));
  }
  return result;
};

const pointAtDistance = (locations: Location[], distances: number[], target: number): Location | null => {
  if (!locations.length) return null;
  if (target <= 0) return locations[0];
  const total = distances[distances.length - 1] ?? 0;
  if (target >= total) return locations[locations.length - 1];
  for (let i = 1; i < distances.length; i += 1) {
    if (distances[i] < target) continue;
    const span = Math.max(0.001, distances[i] - distances[i - 1]);
    const t = (target - distances[i - 1]) / span;
    return {
      lat: locations[i - 1].lat + (locations[i].lat - locations[i - 1].lat) * t,
      lng: locations[i - 1].lng + (locations[i].lng - locations[i - 1].lng) * t,
    };
  }
  return locations[locations.length - 1];
};

/** Builds deterministic scene-bubble centers ahead of the driver. */
export const buildRouteScenePrefetchPlan = (
  route: Route3DHighlight | null,
  userLocation: Location | null,
  maneuvers: Maneuver[] = [],
  options: RouteScenePrefetchOptions = {},
): RouteScenePrefetchPlan => {
  const horizonMeters = Math.max(220, options.horizonMeters ?? DEFAULT_HORIZON_METERS);
  const spacingMeters = Math.max(80, options.spacingMeters ?? DEFAULT_SPACING_METERS);
  const maxLocations = Math.max(1, options.maxLocations ?? DEFAULT_MAX_LOCATIONS);
  const routeLocations = route?.segments.flatMap((segment) => segment.coords).map(({ lat, lng }) => ({ lat, lng })) ?? [];
  if (!routeLocations.length) return { locations: [], keys: [], horizonMeters };

  const startIndex = userLocation
    ? routeLocations.reduce((best, point, index) => distanceMeters(point, userLocation) < distanceMeters(routeLocations[best], userLocation) ? index : best, 0)
    : 0;
  const forward = routeLocations.slice(startIndex);
  if (!forward.length) return { locations: [], keys: [], horizonMeters };
  const distances = cumulativeDistances(forward);
  const totalAhead = Math.min(horizonMeters, distances[distances.length - 1] ?? 0);

  const targets: number[] = [];
  for (let d = spacingMeters; d <= totalAhead && targets.length < maxLocations; d += spacingMeters) targets.push(d);
  // Maneuver locations get priority because their scene has the highest navigation value.
  for (const maneuver of maneuvers) {
    if (targets.length >= maxLocations) break;
    const d = distanceMeters(forward[0], maneuver.location);
    if (d > 20 && d <= totalAhead) targets.push(d);
  }
  targets.sort((a, b) => a - b);

  const seen = new Set<string>();
  const locations: Location[] = [];
  for (const target of targets) {
    const point = pointAtDistance(forward, distances, target);
    if (!point) continue;
    const key = sceneCacheKey(point, 220);
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(point);
    if (locations.length >= maxLocations) break;
  }
  return { locations, keys: locations.map((location) => sceneCacheKey(location, 220)), horizonMeters };
};
