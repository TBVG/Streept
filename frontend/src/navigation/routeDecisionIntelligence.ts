import { Location, Report, Route3DHighlight, SceneContext } from '../types';
import { matchSceneWay } from './sceneWayMatcher';
import { RoadIntelligenceAggregate } from './spatialIntelligenceApi';
import { scoreRoute } from './routeQuality';

export interface RouteDecisionProfile {
  routeIndex: number;
  baseScore: number;
  learnedDifficulty: number;
  learnedConfidence: number;
  difficultRoads: number;
  highAttentionRoads: number;
  maneuverComplexity: number;
  recommendationScore: number;
  reason: string;
  wayIds: number[];
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function routePolyline(route: Route3DHighlight): Location[] {
  return route.segments.flatMap((segment) => segment.coords.map((coord) => ({ lat: coord.lat, lng: coord.lng })));
}

/**
 * Maps route geometry back onto the current OSM scene. Missing scene matches
 * are intentionally ignored; route selection must never invent topology.
 */
export function deriveRouteWayIds(route: Route3DHighlight, scene: SceneContext | null): number[] {
  if (!scene?.roads?.length) return [];
  const points = routePolyline(route);
  const ids: number[] = [];
  let previous: number | null = null;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const match = matchSceneWay(point, scene.roads, previous, 55);
    if (!match) continue;
    previous = match.wayId;
    if (ids[ids.length - 1] !== match.wayId) ids.push(match.wayId);
  }
  return ids;
}

function roadDifficulty(wayIds: number[], community: Map<number, RoadIntelligenceAggregate>): {
  score: number; confidence: number; difficult: number; highAttention: number;
} {
  let weighted = 0;
  let weight = 0;
  let difficult = 0;
  let highAttention = 0;
  for (const wayId of wayIds) {
    const item = community.get(wayId);
    if (!item || item.observations <= 0 || item.confidence <= 0) continue;
    const confidence = clamp(item.confidence, 0, 1);
    const evidence = Math.min(1, item.observations / 12);
    const w = confidence * (0.35 + evidence * 0.65);
    weighted += clamp(item.score) * w;
    weight += w;
    if (item.score >= 70 && confidence >= 0.45) difficult += 1;
    if (item.score >= 85 && confidence >= 0.65) highAttention += 1;
  }
  return {
    score: weight ? weighted / weight : 0,
    confidence: clamp(weight / Math.max(1, wayIds.length * 0.75), 0, 1),
    difficult,
    highAttention,
  };
}

/**
 * Produces an explainable route choice score. Travel time remains the anchor;
 * learned road difficulty can only influence the preference within a bounded
 * range, so community data cannot turn a valid route into an unsafe decision.
 */
export function buildRouteDecisionProfiles(
  routes: Route3DHighlight[],
  reports: Report[],
  scene: SceneContext | null,
  community: Map<number, RoadIntelligenceAggregate>,
): RouteDecisionProfile[] {
  return routes.map((route, routeIndex) => {
    const wayIds = deriveRouteWayIds(route, scene);
    const learned = roadDifficulty(wayIds, community);
    const complexity = clamp(
      route.maneuvers.length * 4 + route.maneuvers.filter((maneuver) => maneuver.is_complex).length * 12,
      0,
    );
    const base = scoreRoute(route, reports);
    const learnedPenalty = learned.score * (0.35 + learned.confidence * 0.65);
    // Keep the learned component bounded relative to the routing provider's
    // score. This is a preference signal, not a replacement for routing.
    const recommendationScore = base + learnedPenalty * 0.9 + complexity * 0.7;
    let reason = 'Fast, straightforward route';
    if (learned.highAttention > 0) reason = `${learned.highAttention} learned high-attention road${learned.highAttention === 1 ? '' : 's'} ahead`;
    else if (learned.difficult > 0) reason = `${learned.difficult} learned difficult road${learned.difficult === 1 ? '' : 's'} ahead`;
    else if (complexity >= 30) reason = 'Higher maneuver complexity';
    return {
      routeIndex,
      baseScore: base,
      learnedDifficulty: Math.round(learned.score),
      learnedConfidence: learned.confidence,
      difficultRoads: learned.difficult,
      highAttentionRoads: learned.highAttention,
      maneuverComplexity: Math.round(complexity),
      recommendationScore,
      reason,
      wayIds,
    };
  });
}

export function rankRoutesBySpatialIntelligence(profiles: RouteDecisionProfile[]): number[] {
  return [...profiles]
    .sort((a, b) => a.recommendationScore - b.recommendationScore)
    .map((profile) => profile.routeIndex);
}
