import { Maneuver, RouteCoord, SceneRestriction, SceneRoad } from '../types';
import { buildJunctionLaneContinuity } from './junctionLaneContinuity';
import { buildJunctionConnector, classifyJunctionGeometry, JunctionGeometryKind } from './junctionGeometry';
import { scoreOutgoingRoad } from './laneIntersectionIntelligence';
import { evaluateNextWayRestriction, evaluateTurnRestriction } from './turnRestrictionGraph';
import { buildLaneCenterline, laneHeading, roadApproachGeometry } from './laneGeometry';
import { laneChangeAllows, parseOsmLaneSemantics } from './osmLaneSemantics';

export interface PhysicalLaneConnector {
  fromWayId: number;
  toWayId: number;
  fromLane: number;
  toLane: number;
  junctionNodeId: number;
  points: RouteCoord[];
  confidence: number;
  geometryKind?: JunctionGeometryKind;
  geometryLengthMeters?: number;
}

export interface PhysicalLaneTopology {
  connectors: PhysicalLaneConnector[];
  junctionNodeId: number | null;
}

function endpointDistance(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number {
  return Math.hypot((a.lat-b.lat)*110540, (a.lng-b.lng)*111320*Math.cos(a.lat*Math.PI/180));
}


function canApproachJunction(road: SceneRoad, junctionNodeId: number): boolean {
  const ids = road.node_ids ?? [];
  if (ids.length < 2) return false;
  const atStart = ids[0] === junctionNodeId;
  const atEnd = ids[ids.length - 1] === junctionNodeId;
  if (!atStart && !atEnd) return false;
  if (!road.oneway) return true;
  // oneway=true follows node order; oneway_reverse follows reverse order.
  return road.oneway_reverse ? atStart : atEnd;
}

function canDepartJunction(road: SceneRoad, junctionNodeId: number): boolean {
  const ids = road.node_ids ?? [];
  if (ids.length < 2) return false;
  const atStart = ids[0] === junctionNodeId;
  const atEnd = ids[ids.length - 1] === junctionNodeId;
  if (!atStart && !atEnd) return false;
  if (!road.oneway) return true;
  return road.oneway_reverse ? atEnd : atStart;
}

function roadEndpoint(road: SceneRoad, nodeId: number): RouteCoord | null {
  const ids = road.node_ids ?? [];
  const idx = ids.indexOf(nodeId);
  if (idx < 0) return null;
  const point = road.geometry[idx];
  return point ? { ...point, alt: 0 } : null;
}

/**
 * Uses OSM shared node IDs to turn a junction into explicit lane-to-lane
 * geometry. This is intentionally separate from OSRM's lane metadata: OSRM
 * says which lanes are valid, while OSM way/node topology tells us where the
 * physical roads actually meet.
 */
export function buildPhysicalLaneTopology(
  roads: SceneRoad[],
  maneuver: Maneuver,
  targetLaneIndex: number | null = null,
  restrictions: SceneRestriction[] | undefined = undefined,
  traversedWayIds: number[] = [],
): PhysicalLaneTopology {
  const candidates = roads.filter((road) => (road.node_ids?.length ?? 0) >= 2 && road.geometry.length >= 2);
  if (!candidates.length) return { connectors: [], junctionNodeId: null };

  // Find the OSM endpoint nearest the maneuver, then use shared node IDs to
  // identify the actual connected ways. This avoids proximity-only junctions.
  let incoming: SceneRoad | null = null;
  let incomingNode: number | null = null;
  let incomingDistance = Number.POSITIVE_INFINITY;
  for (const road of candidates) {
    for (const nodeId of [road.node_ids![0], road.node_ids![road.node_ids!.length - 1]]) {
      const point = roadEndpoint(road, nodeId);
      if (!point) continue;
      const d = endpointDistance(point, maneuver.location);
      if (d < incomingDistance) { incomingDistance = d; incoming = road; incomingNode = nodeId; }
    }
  }
  if (!incoming || incomingNode == null || incomingDistance > 80 || !canApproachJunction(incoming, incomingNode)) return { connectors: [], junctionNodeId: null };

  const isUturn = maneuver.type.toLowerCase().includes('uturn') || maneuver.modifier?.toLowerCase().includes('uturn') || maneuver.modifier?.toLowerCase().includes('u-turn');
  const connected = candidates
    .filter((road) => (road !== incoming || isUturn) && (road.node_ids ?? []).includes(incomingNode!))
    .filter((road) => canDepartJunction(road, incomingNode!))
    .filter((road) => {
      if (!restrictions?.length || !incoming?.osm_id || !road.osm_id) return true;
      const sequence = traversedWayIds.length ? traversedWayIds : [incoming.osm_id];
      const result = sequence.length > 1
        ? evaluateNextWayRestriction(restrictions, sequence, road.osm_id, incomingNode)
        : evaluateTurnRestriction(restrictions, incoming.osm_id, road.osm_id, incomingNode);
      return result.decision !== 'prohibited';
    })
    .sort((a, b) => scoreOutgoingRoad(maneuver, incoming!, b) - scoreOutgoingRoad(maneuver, incoming!, a));
  if (!connected.length) return { connectors: [], junctionNodeId: incomingNode };

  const fromCount = Math.max(1, Math.min(8, incoming.lanes ?? 2));
  const approach = roadApproachGeometry(incoming, incomingNode, 7);
  if (!approach || approach.length < 2) return { connectors: [], junctionNodeId: incomingNode };
  const approachBearing = laneHeading(approach, true);
  const junction = roadEndpoint(incoming, incomingNode);
  if (!junction) return { connectors: [], junctionNodeId: incomingNode };

  const connectors: PhysicalLaneConnector[] = [];
  for (const outgoing of connected.slice(0, 6)) {
    const outApproach = roadApproachGeometry(outgoing, incomingNode, 7);
    if (!outApproach || outApproach.length < 2) continue;
    const outBearing = laneHeading(outApproach, false);
    const toCount = Math.max(1, Math.min(8, outgoing.lanes ?? 2));

    // Prefer lanes whose OSM turn:lanes semantics actually match the
    // maneuver. OSRM's recommended lane remains the strongest explicit
    // signal when supplied, but OSM semantics prevent a proportional lane
    // mapping from selecting a physically wrong turn lane.
    const semantics = parseOsmLaneSemantics(incoming, maneuver, fromCount);
    const semanticTargets = semantics.filter((lane) => lane.routeScore === 1).map((lane) => lane.index);
    const requested = targetLaneIndex != null && targetLaneIndex < toCount ? targetLaneIndex : null;
    const desired = requested != null
      ? requested
      : (semanticTargets.length ? semanticTargets[Math.floor(semanticTargets.length / 2)] : Math.floor(toCount / 2));
    const proportionalSource = Math.max(0, Math.min(fromCount - 1, Math.round(desired * (fromCount - 1) / Math.max(1, toCount - 1))));
    const sourceLane = semanticTargets.length
      ? semanticTargets.reduce((best, lane) => Math.abs(lane - proportionalSource) < Math.abs(best - proportionalSource) ? lane : best, semanticTargets[0])
      : proportionalSource;
    if (!laneChangeAllows(incoming, sourceLane, desired, fromCount)) continue;

    const fromLane = buildLaneCenterline(incoming, sourceLane, fromCount);
    const toLane = buildLaneCenterline(outgoing, desired, toCount);
    if (!fromLane || !toLane) continue;

    const incomingPoints = fromLane.points.slice(-Math.min(7, fromLane.points.length));
    const outgoingPoints = toLane.points.slice(0, Math.min(7, toLane.points.length));
    if (incomingPoints.length < 2 || outgoingPoints.length < 2) continue;

    const mappedContinuity = buildJunctionLaneContinuity([incoming, outgoing], [incoming.osm_id ?? 0, outgoing.osm_id ?? 0], maneuver ? [maneuver] : [], restrictions)
      .find((candidate) => candidate.fromLane === sourceLane && candidate.toLane === desired);
    const geometry = mappedContinuity?.geometry
      ? { points: mappedContinuity.geometry.points, lengthMeters: mappedContinuity.geometry.lengthMeters, confidence: mappedContinuity.geometry.confidence, kind: mappedContinuity.geometry.kind }
      : buildJunctionConnector(incomingPoints, outgoingPoints, maneuver, classifyJunctionGeometry(maneuver, incoming, outgoing));
    const turnDelta = Math.abs(((outBearing - approachBearing + 540) % 360) - 180);
    const geometryConfidence = Math.max(0.55, 1 - Math.max(0, turnDelta - 135) / 180 * 0.25);
    const semanticConfidence = semanticTargets.length ? (semantics[sourceLane]?.routeScore ?? 0.35) : 0.72;
    const confidence = geometryConfidence * geometry.confidence * semanticConfidence * (incoming.osm_id && outgoing.osm_id ? 1 : 0.92);
    connectors.push({
      fromWayId: incoming.osm_id ?? 0,
      toWayId: outgoing.osm_id ?? 0,
      fromLane: sourceLane,
      toLane: desired,
      junctionNodeId: incomingNode,
      points: geometry.points,
      confidence,
      geometryKind: geometry.kind,
      geometryLengthMeters: geometry.lengthMeters,
    });
  }
  return { connectors, junctionNodeId: incomingNode };
}
