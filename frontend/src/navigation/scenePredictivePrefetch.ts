import { Location, Maneuver, Route3DHighlight } from '../types';
import { RenderQualityTier } from './adaptiveRenderQuality';
import { SceneChunk } from './sceneChunks';
import { destinationPoint, bearingDegrees } from '../utils/geo';

export interface PredictiveSceneTarget {
  location: Location;
  horizonMeters: number;
  priority: number;
  maneuverIndex: number | null;
}

export interface PredictiveScenePrefetchPlan {
  targets: PredictiveSceneTarget[];
  orderedChunkKeys: string[];
  primaryChunkKey: string | null;
}

const distanceMeters = (a: Location, b: Location) => {
  const latScale = 111320;
  const lngScale = latScale * Math.max(0.2, Math.cos(a.lat * Math.PI / 180));
  return Math.hypot((a.lat - b.lat) * latScale, (a.lng - b.lng) * lngScale);
};

const qualityHorizon: Record<RenderQualityTier, number> = {
  high: 900,
  balanced: 700,
  performance: 500,
};

const qualityTargets: Record<RenderQualityTier, number> = {
  high: 5,
  balanced: 4,
  performance: 2,
};

const routeCoordinates = (route: Route3DHighlight) => Array.isArray((route as any).coordinates) ? (route as any).coordinates : route.segments.flatMap((segment) => segment.coords);

const nearestRouteIndex = (route: Route3DHighlight, location: Location): number => {
  const coordinates = routeCoordinates(route);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  coordinates.forEach((point: Location, index: number) => {
    const d = distanceMeters(location, point);
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  });
  return best;
};

const routePointAtDistance = (route: Route3DHighlight, startIndex: number, meters: number): Location => {
  const coordinates = routeCoordinates(route);
  if (!coordinates.length) return { lat: 0, lng: 0 };
  let travelled = 0;
  let previous = coordinates[startIndex];
  for (let i = startIndex + 1; i < coordinates.length; i += 1) {
    const current = coordinates[i];
    const segment = distanceMeters(previous, current);
    if (travelled + segment >= meters) {
      const t = segment <= 0 ? 0 : (meters - travelled) / segment;
      return { lat: previous.lat + (current.lat - previous.lat) * t, lng: previous.lng + (current.lng - previous.lng) * t };
    }
    travelled += segment;
    previous = current;
  }
  return coordinates[coordinates.length - 1];
};

/**
 * Predicts where the driver will need scene coverage next. This is deliberately
 * framework-neutral: it only uses route geometry, speed and maneuver timing,
 * allowing the Cesium renderer and network prefetcher to share one forecast.
 */
export function buildPredictiveScenePrefetchPlan(
  route: Route3DHighlight,
  location: Location,
  speedMps: number,
  maneuvers: Maneuver[] = route.maneuvers ?? [],
  chunks: SceneChunk[] = [],
  quality: RenderQualityTier = 'high',
): PredictiveScenePrefetchPlan {
  const speed = Math.max(0, speedMps);
  const horizon = Math.min(qualityHorizon[quality], Math.max(320, speed * 18 + 360));
  const startIndex = nearestRouteIndex(route, location);
  const distances = [0, horizon * 0.28, horizon * 0.58, horizon * 0.84].filter((d, i, all) => d <= horizon && (i === 0 || d > all[i - 1]));
  const targets: PredictiveSceneTarget[] = distances.map((d, index) => ({
    location: routePointAtDistance(route, startIndex, d),
    horizonMeters: d,
    priority: index === 0 ? 1 : 1 - d / (horizon * 1.15),
    maneuverIndex: (() => {
      let best: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      maneuvers.forEach((m, mi) => {
        const md = distanceMeters(location, m.location);
        if (md >= d && md < bestDistance) { bestDistance = md; best = mi; }
      });
      return best;
    })(),
  }));

  const coordinates = routeCoordinates(route);
  if (speed > 1 && coordinates.length > 1) {
    const a = coordinates[startIndex];
    const b = coordinates[Math.min(startIndex + 1, coordinates.length - 1)];
    const heading = bearingDegrees(a, b);
    // Add a short forward projection so the handoff has a directional bias even
    // when the route samples are sparse around the current position.
    targets.push({ location: destinationPoint(location, heading, Math.min(180, speed * 4)), horizonMeters: 180, priority: 0.92, maneuverIndex: null });
  }

  const uniqueTargets = targets.filter((target, index, all) => all.findIndex((other) => distanceMeters(other.location, target.location) < 35) === index)
    .slice(0, qualityTargets[quality]);

  const scoredChunks = chunks.map((chunk) => {
    const distancesToTargets = uniqueTargets.map((target) => ({ target, distance: distanceMeters(chunk.center, target.location) }));
    const best = distancesToTargets.sort((a, b) => a.distance - b.distance)[0];
    const nearCurrent = distanceMeters(chunk.center, location);
    const score = (best ? best.target.priority * Math.max(0, 1 - best.distance / 650) : 0) + Math.max(0, 1 - nearCurrent / 350) * 0.35;
    return { key: chunk.key, score, nearCurrent };
  }).sort((a, b) => b.score - a.score || a.nearCurrent - b.nearCurrent);

  const maxChunks = quality === 'high' ? 7 : quality === 'balanced' ? 5 : 3;
  const orderedChunkKeys = scoredChunks.slice(0, maxChunks).map((item) => item.key);
  return { targets: uniqueTargets, orderedChunkKeys, primaryChunkKey: orderedChunkKeys[0] ?? null };
}
