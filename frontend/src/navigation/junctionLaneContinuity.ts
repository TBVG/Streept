import { Maneuver, SceneRestriction, SceneRoad } from '../types';
import { laneChangeAllows, parseOsmLaneSemantics } from './osmLaneSemantics';
import { buildJunctionConnector, classifyJunctionGeometry, JunctionGeometryKind } from './junctionGeometry';
import { buildLaneCenterline } from './laneGeometry';
import { evaluateNextWayRestriction } from './turnRestrictionGraph';

export type JunctionLaneContinuityReason = 'direct' | 'turn-lane' | 'merge' | 'split' | 'restriction' | 'direction' | 'fallback';

export interface JunctionLaneContinuity {
  fromWayId: number;
  toWayId: number;
  fromLane: number;
  toLane: number;
  junctionNodeId: number;
  legal: boolean;
  confidence: number;
  cost: number;
  reason: JunctionLaneContinuityReason;
  geometry?: { points: import('../types').RouteCoord[]; kind: JunctionGeometryKind; lengthMeters: number; confidence: number };
}

function count(road: SceneRoad): number {
  return Math.max(1, Math.min(8, road.lanes ?? 1));
}

function endpointIndex(road: SceneRoad, node: number): number {
  const ids = road.node_ids ?? [];
  if (!ids.length) return -1;
  if (ids[0] === node) return 0;
  if (ids[ids.length - 1] === node) return ids.length - 1;
  return -1;
}

function canApproach(road: SceneRoad, node: number): boolean {
  const index = endpointIndex(road, node);
  if (index < 0) return false;
  if (!road.oneway) return true;
  return road.oneway_reverse ? index === 0 : index === road.node_ids!.length - 1;
}

function canDepart(road: SceneRoad, node: number): boolean {
  const index = endpointIndex(road, node);
  if (index < 0) return false;
  if (!road.oneway) return true;
  return road.oneway_reverse ? index === road.node_ids!.length - 1 : index === 0;
}

function sharedNode(fromRoad: SceneRoad, toRoad: SceneRoad): number | null {
  const from = fromRoad.node_ids ?? [];
  const to = new Set(toRoad.node_ids ?? []);
  for (const node of [from[0], from[from.length - 1]]) {
    if (node != null && to.has(node)) return node;
  }
  return null;
}

function semanticSourceLanes(road: SceneRoad, maneuver: Maneuver | null, laneCount: number): number[] {
  if (!maneuver) return [];
  return parseOsmLaneSemantics(road, maneuver, laneCount)
    .filter((lane) => lane.routeScore === 1)
    .map((lane) => lane.index);
}

/**
 * Resolve lane identity at a real OSM junction. Unlike simple lane-count
 * interpolation, this keeps a lane tied to the maneuver it is allowed to
 * perform, then maps it onto the physically corresponding downstream lane.
 * The result is deliberately confidence-weighted: ambiguous geometry never
 * becomes a high-confidence lane claim.
 */
function connectorGeometry(
  fromRoad: SceneRoad,
  toRoad: SceneRoad,
  node: number,
  fromLane: number,
  toLane: number,
  maneuver: Maneuver | null,
): JunctionLaneContinuity['geometry'] | undefined {
  const geometryManeuver = maneuver ?? {
    type: 'turn', modifier: 'straight', location: fromRoad.geometry[fromRoad.geometry.length - 1] ?? { lat: 0, lng: 0 },
    bearing_before: 0, instruction: 'through', is_complex: false,
  };
  const fromCenter = buildLaneCenterline(fromRoad, fromLane, count(fromRoad));
  const toCenter = buildLaneCenterline(toRoad, toLane, count(toRoad));
  if (!fromCenter || !toCenter) return undefined;
  const fromIds = fromRoad.node_ids ?? [];
  const toIds = toRoad.node_ids ?? [];
  const fromIndex = fromIds.indexOf(node);
  const toIndex = toIds.indexOf(node);
  if (fromIndex < 0 || toIndex < 0) return undefined;
  const incoming = fromIndex === 0
    ? [...fromCenter.points.slice(0, 7)].reverse()
    : fromCenter.points.slice(Math.max(0, fromCenter.points.length - 7));
  const outgoing = toIndex === 0
    ? toCenter.points.slice(0, 7)
    : [...toCenter.points.slice(Math.max(0, toCenter.points.length - 7))].reverse();
  if (incoming.length < 2 || outgoing.length < 2) return undefined;
  const kind = classifyJunctionGeometry(geometryManeuver, fromRoad, toRoad);
  const geometry = buildJunctionConnector(incoming, outgoing, geometryManeuver, kind);
  return { points: geometry.points, kind: geometry.kind, lengthMeters: geometry.lengthMeters, confidence: geometry.confidence };
}

export function mapLaneThroughJunction(
  fromRoad: SceneRoad | null,
  toRoad: SceneRoad | null,
  fromLane: number,
  maneuver: Maneuver | null = null,
  restrictions: SceneRestriction[] = [],
  history: number[] = [],
): JunctionLaneContinuity | null {
  if (!fromRoad?.osm_id || !toRoad?.osm_id) return null;
  const node = sharedNode(fromRoad, toRoad);
  if (node == null) return null;
  if (!canApproach(fromRoad, node) || !canDepart(toRoad, node)) {
    return { fromWayId: fromRoad.osm_id, toWayId: toRoad.osm_id, fromLane, toLane: 0, junctionNodeId: node, legal: false, confidence: 1, cost: 1000, reason: 'direction' };
  }

  const fromCount = count(fromRoad);
  const toCount = count(toRoad);
  const source = Math.max(0, Math.min(fromCount - 1, fromLane));
  const semanticSources = semanticSourceLanes(fromRoad, maneuver, fromCount);
  const sourceIsTurnCompatible = !maneuver || semanticSources.length === 0 || semanticSources.includes(source);

  const restriction = restrictions.length
    ? evaluateNextWayRestriction(restrictions, history.length ? history : [fromRoad.osm_id], toRoad.osm_id, node)
    : { decision: 'allowed' as const, confidence: 1 };
  if (restriction.decision === 'prohibited') {
    return { fromWayId: fromRoad.osm_id, toWayId: toRoad.osm_id, fromLane: source, toLane: 0, junctionNodeId: node, legal: false, confidence: restriction.confidence, cost: 1000, reason: 'restriction' };
  }

  // If OSM turn:lanes says this source lane cannot perform the maneuver, keep
  // the mapping available only as a low-confidence fallback for GPS recovery.
  const candidateSources = semanticSources.length
    ? [source, ...semanticSources.filter((lane) => lane !== source)]
    : [source];

  let best: JunctionLaneContinuity | null = null;
  for (const candidateSource of candidateSources) {
    const sourceDelta = Math.abs(candidateSource - source);
    const sourcePenalty = sourceDelta * 0.8;
    if (candidateSource !== source && !laneChangeAllows(fromRoad, source, candidateSource, fromCount)) continue;

    const targetSemantic = maneuver
      ? parseOsmLaneSemantics(toRoad, maneuver, toCount)
          .filter((lane) => lane.routeScore === 1)
          .map((lane) => lane.index)
      : [];

    const mapped = Math.max(0, Math.min(toCount - 1, Math.round(candidateSource * (toCount - 1) / Math.max(1, fromCount - 1))));
    const targetCandidates = targetSemantic.length
      ? [mapped, ...targetSemantic.filter((lane) => lane !== mapped)]
      : [mapped];

    for (const target of targetCandidates) {
      if (!laneChangeAllows(fromRoad, candidateSource, target, fromCount)) continue;
      const countDelta = Math.abs(fromCount - toCount);
      const topologyPenalty = countDelta === 0 ? 0 : countDelta * 0.18;
      const semanticPenalty = maneuver && !sourceIsTurnCompatible ? 0.28 : 0;
      const targetSemanticBonus = targetSemantic.includes(target) ? 0.12 : 0;
      const confidence = Math.max(0.28, Math.min(0.98,
        0.88 - sourcePenalty * 0.08 - topologyPenalty - semanticPenalty + targetSemanticBonus,
      )) * (restriction.decision === 'unresolved' ? 0.82 : 1);
      const reason: JunctionLaneContinuityReason = targetSemantic.includes(target) || semanticSources.includes(candidateSource)
        ? 'turn-lane'
        : fromCount === toCount ? 'direct'
          : toCount < fromCount ? 'merge'
          : target === candidateSource ? 'direct' : 'split';
      const cost = sourcePenalty + topologyPenalty + (reason === 'turn-lane' ? 0 : 0.35);
      const geometry = connectorGeometry(fromRoad, toRoad, node, candidateSource, target, maneuver);
      const result = {
        fromWayId: fromRoad.osm_id,
        toWayId: toRoad.osm_id,
        fromLane: source,
        toLane: target,
        junctionNodeId: node,
        legal: true,
        confidence: geometry ? Math.min(confidence, geometry.confidence) : confidence,
        cost: cost + (geometry ? 0 : 0.2),
        reason,
        geometry,
      };
      if (!best || result.cost < best.cost || (result.cost === best.cost && result.confidence > best.confidence)) best = result;
    }
  }

  if (best) return best;
  return { fromWayId: fromRoad.osm_id, toWayId: toRoad.osm_id, fromLane: source, toLane: mappedFallback(source, fromCount, toCount), junctionNodeId: node, legal: sourceIsTurnCompatible, confidence: sourceIsTurnCompatible ? 0.45 : 0.25, cost: 2.5, reason: 'fallback' };
}

function mappedFallback(source: number, fromCount: number, toCount: number): number {
  return Math.max(0, Math.min(toCount - 1, Math.round(source * (toCount - 1) / Math.max(1, fromCount - 1))));
}

export function buildJunctionLaneContinuity(
  roads: SceneRoad[],
  waySequence: number[],
  maneuvers: Maneuver[] = [],
  restrictions: SceneRestriction[] = [],
): JunctionLaneContinuity[] {
  const usable = roads.filter((road) => road.osm_id != null && (road.node_ids?.length ?? 0) >= 2);
  const result: JunctionLaneContinuity[] = [];
  for (let i = 0; i < waySequence.length - 1; i += 1) {
    const fromWayId = waySequence[i];
    const toWayId = waySequence[i + 1];
    if (fromWayId <= 0 || toWayId <= 0) continue;
    const fromRoad = usable.find((road) => road.osm_id === fromWayId) ?? null;
    const toRoad = usable.find((road) => road.osm_id === toWayId) ?? null;
    if (!fromRoad || !toRoad) continue;
    const maneuver = maneuvers[i] ?? null;
    const history = waySequence.slice(Math.max(0, i - 7), i + 1);
    for (let lane = 0; lane < count(fromRoad); lane += 1) {
      const mapping = mapLaneThroughJunction(fromRoad, toRoad, lane, maneuver, restrictions, history);
      if (mapping) result.push(mapping);
    }
  }
  return result;
}
