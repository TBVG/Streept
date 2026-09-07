import { Maneuver, SceneContext, SceneRestriction, SceneRoad } from '../types';
import { evaluateNextWayRestriction } from './turnRestrictionGraph';
import { buildJunctionLaneContinuity } from './junctionLaneContinuity';

export interface LaneGraphEdge {
  fromWayId: number;
  toWayId: number;
  fromLane: number;
  toLane: number;
  junctionNodeId: number | null;
  legal: boolean;
  cost: number;
  confidence: number;
  reason: 'continuity' | 'merge' | 'split' | 'lane-drop' | 'restriction' | 'direction' | 'fallback';
  continuity: 'direct' | 'merged' | 'split' | 'fallback';
}

export interface LaneGraph {
  edges: LaneGraphEdge[];
  waySequence: number[];
  confidence: number;
}

function sharedEndpoint(a: SceneRoad, b: SceneRoad): number | null {
  const aIds = a.node_ids ?? [];
  const bIds = new Set(b.node_ids ?? []);
  for (const id of [aIds[0], aIds[aIds.length - 1]]) {
    if (id != null && bIds.has(id)) return id;
  }
  return null;
}

function canApproach(road: SceneRoad, node: number): boolean {
  const ids = road.node_ids ?? [];
  if (ids.length < 2) return false;
  if (!ids.includes(node)) return false;
  if (!road.oneway) return true;
  const atStart = ids[0] === node;
  const atEnd = ids[ids.length - 1] === node;
  return road.oneway_reverse ? atStart : atEnd;
}

function canDepart(road: SceneRoad, node: number): boolean {
  const ids = road.node_ids ?? [];
  if (ids.length < 2) return false;
  if (!ids.includes(node)) return false;
  if (!road.oneway) return true;
  const atStart = ids[0] === node;
  const atEnd = ids[ids.length - 1] === node;
  return road.oneway_reverse ? atEnd : atStart;
}

function laneCount(road: SceneRoad): number {
  return Math.max(1, Math.min(8, road.lanes ?? 1));
}

interface LaneContinuityCandidate {
  toLane: number;
  continuity: LaneGraphEdge['continuity'];
  reason: LaneGraphEdge['reason'];
  cost: number;
}

/**
 * Model physical lane-count changes explicitly instead of treating every
 * incoming/outgoing lane pair as an equally good proportional mapping.
 *
 * - Equal counts preserve lane identity.
 * - A split (more outgoing lanes) preserves existing lanes and lets new lanes
 *   appear at the nearest carriageway edge with a higher cost.
 * - A merge (fewer outgoing lanes) maps multiple source lanes into the nearest
 *   surviving lane and marks the extra mapping as a merge/lane-drop edge.
 */
function laneContinuityCandidates(fromLane: number, fromCount: number, toCount: number): LaneContinuityCandidate[] {
  if (fromCount <= 0 || toCount <= 0) return [];
  if (fromCount === toCount) return [{ toLane: fromLane, continuity: 'direct', reason: 'continuity', cost: 0 }];

  if (toCount > fromCount) {
    const direct = Math.min(fromLane, toCount - 1);
    const candidates: LaneContinuityCandidate[] = [{ toLane: direct, continuity: 'direct', reason: 'continuity', cost: 0.25 }];
    // A newly created lane is not a guaranteed continuation of one specific
    // source lane. Keep one adjacent alternative so route planning can enter
    // the added lane without fabricating a hard correspondence.
    if (direct + 1 < toCount) candidates.push({ toLane: direct + 1, continuity: 'split', reason: 'split', cost: 1.75 });
    if (direct - 1 >= 0) candidates.push({ toLane: direct - 1, continuity: 'split', reason: 'split', cost: 1.75 });
    return candidates;
  }

  const direct = Math.max(0, Math.min(toCount - 1, fromLane));
  const candidates: LaneContinuityCandidate[] = [{ toLane: direct, continuity: fromLane < toCount ? 'direct' : 'merged', reason: fromLane < toCount ? 'continuity' : 'lane-drop', cost: fromLane < toCount ? 0.25 : 0.75 }];
  if (direct + 1 < toCount) candidates.push({ toLane: direct + 1, continuity: 'merged', reason: 'merge', cost: 1.5 });
  if (direct - 1 >= 0) candidates.push({ toLane: direct - 1, continuity: 'merged', reason: 'merge', cost: 1.5 });
  return candidates;
}

/**
 * Build a directional physical lane graph from OSM way/node topology.
 * Every edge is an actual lane-to-lane continuation across a shared junction
 * node. OSM restrictions are evaluated before the edge is considered legal.
 */
export function buildPhysicalLaneGraph(
  roads: SceneRoad[],
  restrictions: SceneRestriction[] = [],
  waySequence: number[] = [],
  maneuverByTransition: Maneuver[] = [],
): LaneGraph {
  const usable = roads.filter((r) => r.osm_id != null && (r.node_ids?.length ?? 0) >= 2 && r.geometry.length >= 2);
  const edges: LaneGraphEdge[] = [];
  // Preserve repeated ways when a route loops back; only collapse consecutive
  // duplicates caused by dense route sampling.
  const uniqueWays = waySequence.filter((id, index, values) => id > 0 && (index === 0 || id !== values[index - 1]));
  const junctionContinuity = buildJunctionLaneContinuity(roads, uniqueWays, maneuverByTransition, restrictions);

  for (let i = 0; i < uniqueWays.length - 1; i += 1) {
    const fromWayId = uniqueWays[i];
    const toWayId = uniqueWays[i + 1];
    const incoming = usable.find((r) => r.osm_id === fromWayId);
    const outgoing = usable.find((r) => r.osm_id === toWayId);
    if (!incoming || !outgoing) continue;
    const node = sharedEndpoint(incoming, outgoing);
    if (node == null || !canApproach(incoming, node) || !canDepart(outgoing, node)) {
      edges.push({ fromWayId, toWayId, fromLane: 0, toLane: 0, junctionNodeId: node, legal: false, cost: 1000, confidence: 1, reason: 'direction', continuity: 'fallback' });
      continue;
    }

    const history = uniqueWays.slice(Math.max(0, i - 7), i + 1);
    const restriction = evaluateNextWayRestriction(restrictions, history, toWayId, node);
    const legal = restriction.decision !== 'prohibited';
    const confidence = restriction.decision === 'unresolved' ? 0.7 : restriction.confidence;
    const fromCount = laneCount(incoming);
    const toCount = laneCount(outgoing);
    const maneuver = maneuverByTransition[i] ?? null;

    for (let fromLane = 0; fromLane < fromCount; fromLane += 1) {
      const junction = junctionContinuity.find((candidate) =>
        candidate.fromWayId === fromWayId && candidate.toWayId === toWayId && candidate.fromLane === fromLane
      );
      const geometric = laneContinuityCandidates(fromLane, fromCount, toCount);
      const continuity: LaneContinuityCandidate[] = junction
        ? [
            { toLane: junction.toLane, continuity: junction.reason === 'merge' ? 'merged' : junction.reason === 'split' ? 'split' : junction.reason === 'direct' || junction.reason === 'turn-lane' ? 'direct' : 'fallback', reason: junction.reason === 'merge' ? 'merge' : junction.reason === 'split' ? 'split' : junction.reason === 'restriction' ? 'restriction' : junction.reason === 'direction' ? 'direction' : junction.reason === 'fallback' ? 'fallback' : 'continuity', cost: junction.cost },
            ...geometric.filter((candidate) => candidate.toLane !== junction.toLane),
          ]
        : geometric;
      for (const candidate of continuity) {
        const cost = candidate.cost + (legal ? 0 : 1000);
        edges.push({
          fromWayId,
          toWayId,
          fromLane,
          toLane: candidate.toLane,
          junctionNodeId: node,
          legal: legal && junction?.legal !== false,
          cost,
          confidence: junction ? Math.min(confidence, junction.confidence) : confidence,
          reason: legal ? candidate.reason : 'restriction',
          continuity: candidate.continuity,
        });
      }
    }

    // A maneuver can have no explicit lane metadata. Preserve one fallback
    // edge so route-level connectivity can still be represented.
    if (!maneuver && !edges.some((e) => e.fromWayId === fromWayId && e.toWayId === toWayId)) {
      edges.push({ fromWayId, toWayId, fromLane: 0, toLane: 0, junctionNodeId: node, legal, cost: legal ? 1 : 1000, confidence, reason: 'fallback', continuity: 'fallback' });
    }
  }

  const confidence = edges.length ? edges.reduce((sum, edge) => sum + edge.confidence, 0) / edges.length : 0;
  return { edges, waySequence: uniqueWays, confidence };
}

export function laneTransition(
  graph: LaneGraph,
  fromWayId: number,
  toWayId: number,
  fromLane: number | null = null,
): LaneGraphEdge | null {
  const matches = graph.edges.filter((e) => e.fromWayId === fromWayId && e.toWayId === toWayId && (fromLane == null || e.fromLane === fromLane));
  if (!matches.length) return null;
  return matches.find((e) => e.legal) ?? matches[0];
}

export function buildRoutePhysicalLaneGraph(scene: SceneContext | null, waySequence: number[], maneuvers: Maneuver[] = []): LaneGraph {
  if (!scene) return { edges: [], waySequence: [], confidence: 0 };
  return buildPhysicalLaneGraph(scene.roads, scene.restrictions ?? [], waySequence, maneuvers);
}
