import { Location, Maneuver, Route3DHighlight, SceneContext } from '../types';
import { RoadIntelligenceAggregate } from './spatialIntelligenceApi';
import { deriveRouteWayIds, RouteDecisionProfile } from './routeDecisionIntelligence';
import { deriveIntersectionIntelligence, IntersectionIntelligence } from './intersectionIntelligence';
import { matchSceneWay } from './sceneWayMatcher';

export type RouteGraphNodeKind = 'origin' | 'road' | 'junction' | 'destination';

export interface RouteIntelligenceNode {
  id: string;
  kind: RouteGraphNodeKind;
  wayId: number | null;
  distanceFromStartMeters: number;
  maneuverIndex: number | null;
  difficulty: number;
  confidence: number;
  reasons: string[];
  junction: IntersectionIntelligence | null;
}

export interface RouteIntelligenceGraph {
  routeIndex: number;
  nodes: RouteIntelligenceNode[];
  routeDifficulty: number;
  routeConfidence: number;
  difficultNodes: number;
  highAttentionNodes: number;
  nextCriticalDistanceMeters: number | null;
}

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));

function routePoints(route: Route3DHighlight): Location[] {
  return route.segments.flatMap((segment) => segment.coords.map((c) => ({ lat: c.lat, lng: c.lng })));
}

function cumulativeDistances(points: Location[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]; const b = points[i];
    const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
    const dx = (b.lng - a.lng) * 111320 * Math.cos(lat);
    const dy = (b.lat - a.lat) * 110540;
    out.push(out[out.length - 1] + Math.hypot(dx, dy));
  }
  return out;
}

export function buildRouteIntelligenceGraph(
  route: Route3DHighlight,
  routeIndex: number,
  scene: SceneContext | null,
  community: Map<number, RoadIntelligenceAggregate>,
  profile?: RouteDecisionProfile,
  maneuverDistanceMeters?: number | null,
): RouteIntelligenceGraph {
  const points = routePoints(route);
  const distances = cumulativeDistances(points);
  const wayIds = profile?.wayIds?.length ? profile.wayIds : deriveRouteWayIds(route, scene);
  const nodes: RouteIntelligenceNode[] = [];
  const push = (node: RouteIntelligenceNode) => nodes.push(node);

  push({ id: `route-${routeIndex}-origin`, kind: 'origin', wayId: wayIds[0] ?? null, distanceFromStartMeters: 0, maneuverIndex: null, difficulty: 0, confidence: 0, reasons: [], junction: null });

  route.maneuvers.forEach((maneuver: Maneuver, index) => {
    const point = maneuver.location;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i += 1) {
      const d = Math.hypot((points[i].lat - point.lat) * 110540, (points[i].lng - point.lng) * 111320);
      if (d < best) { best = d; nearest = i; }
    }
    const distance = distances[nearest] ?? 0;
    const road = scene?.roads?.length ? matchSceneWay(point, scene.roads, null, 75) : null;
    const wayId = road?.wayId ?? wayIds[Math.min(index, Math.max(0, wayIds.length - 1))] ?? null;
    const aggregate = wayId == null ? null : community.get(wayId);
    const before = index > 0 && scene?.roads?.length ? matchSceneWay(route.maneuvers[index - 1].location, scene.roads, null, 85) : null;
    const incoming = before ? scene?.roads?.find((item) => item.osm_id === before.wayId) ?? null : (road ? scene?.roads?.find((item) => item.osm_id === road.wayId) ?? null : null);
    const outgoing = road ? scene?.roads?.find((item) => item.osm_id !== road.wayId) ?? null : null;
    const junction = deriveIntersectionIntelligence(maneuver, incoming, outgoing, maneuverDistanceMeters ?? Math.max(0, distance));
    const roadDifficulty = aggregate?.confidence ? clamp(aggregate.score) * Math.min(1, aggregate.confidence) : (profile?.learnedDifficulty ?? 0) * Math.min(1, profile?.learnedConfidence ?? 0);
    const difficulty = clamp(Math.max(roadDifficulty, junction.complexity === 'complex' ? Math.min(100, roadDifficulty * .55 + 62) : roadDifficulty * .7));
    const confidence = Math.max(aggregate?.confidence ?? 0, junction.confidence);
    const reasons: string[] = [];
    if (aggregate && aggregate.score >= 60) reasons.push('learned road difficulty');
    if (junction.complexity === 'complex') reasons.push(junction.behavior.replace('-', ' '));
    if (junction.laneCommitmentRequired) reasons.push('lane commitment');
    push({ id: `route-${routeIndex}-junction-${index}`, kind: 'junction', wayId, distanceFromStartMeters: distance, maneuverIndex: index, difficulty: Math.round(difficulty), confidence, reasons, junction });
  });

  wayIds.forEach((wayId, index) => {
    if (nodes.some((node) => node.kind === 'junction' && node.wayId === wayId)) return;
    const aggregate = community.get(wayId);
    if (!aggregate || aggregate.observations <= 0) return;
    const fraction = wayIds.length > 1 ? index / (wayIds.length - 1) : 0;
    const distance = (route.distance_meters ?? distances[distances.length - 1] ?? 0) * fraction;
    const difficulty = clamp(aggregate.score);
    const reasons = difficulty >= 70 ? ['learned road difficulty'] : difficulty >= 45 ? ['emerging road pattern'] : [];
    push({ id: `route-${routeIndex}-road-${wayId}`, kind: 'road', wayId, distanceFromStartMeters: distance, maneuverIndex: null, difficulty: Math.round(difficulty), confidence: Math.max(0, Math.min(1, aggregate.confidence)), reasons, junction: null });
  });

  push({ id: `route-${routeIndex}-destination`, kind: 'destination', wayId: wayIds[wayIds.length - 1] ?? null, distanceFromStartMeters: route.distance_meters ?? distances[distances.length - 1] ?? 0, maneuverIndex: null, difficulty: 0, confidence: 0, reasons: [], junction: null });
  const meaningful = nodes.filter((node) => node.kind !== 'origin' && node.kind !== 'destination');
  const routeDifficulty = meaningful.length ? Math.round(meaningful.reduce((sum, node) => sum + node.difficulty * Math.max(.1, node.confidence), 0) / meaningful.reduce((sum, node) => sum + Math.max(.1, node.confidence), 0)) : 0;
  const routeConfidence = meaningful.length ? meaningful.reduce((sum, node) => sum + node.confidence, 0) / meaningful.length : 0;
  const high = meaningful.filter((node) => node.difficulty >= 80 && node.confidence >= .55);
  const difficult = meaningful.filter((node) => node.difficulty >= 60 && node.confidence >= .4);
  const critical = meaningful.filter((node) => node.difficulty >= 80 && node.confidence >= .55 && (maneuverDistanceMeters == null || node.distanceFromStartMeters >= (route.distance_meters ?? 0) - maneuverDistanceMeters));
  return { routeIndex, nodes: nodes.sort((a, b) => a.distanceFromStartMeters - b.distanceFromStartMeters), routeDifficulty, routeConfidence, difficultNodes: difficult.length, highAttentionNodes: high.length, nextCriticalDistanceMeters: critical.length ? Math.min(...critical.map((node) => Math.max(0, node.distanceFromStartMeters))) : null };
}
