import { SceneRestriction, SceneRoad } from '../types';
import { deriveSegmentSceneWaySequence } from './sceneWayMatcher';

export type RestrictionDecision = 'allowed' | 'prohibited' | 'unresolved';

export interface TurnRestrictionResult {
  decision: RestrictionDecision;
  matchedRestrictionIds: number[];
  reason: string;
  confidence: number;
}

function appliesToMotorVehicle(restriction: SceneRestriction): boolean {
  const except = (restriction.except ?? '').toLowerCase();
  if (!except) return true;
  const modes = except.split(/[;\s,]+/).filter(Boolean);
  return !modes.includes('motorcar') && !modes.includes('motor_vehicle');
}

function includes(values: number[] | undefined, id: number | null): boolean {
  return id != null && (values ?? []).includes(id);
}

function isOnlyRestriction(value: string): boolean {
  return value.startsWith('only_');
}

function isNoRestriction(value: string): boolean {
  return value.startsWith('no_');
}

function sequenceMatchesPrefix(actual: number[], expected: number[]): boolean {
  if (actual.length < expected.length) return false;
  return expected.every((wayId, index) => actual[actual.length - expected.length + index] === wayId);
}

/**
 * Evaluates a concrete way-to-way junction transition. Via-node restrictions
 * are authoritative because the current maneuver is localized to one node.
 * Via-way relations are returned as unresolved unless route-sequence context
 * is supplied through evaluateNextWayRestriction().
 */
export function evaluateTurnRestriction(
  restrictions: SceneRestriction[] | undefined,
  fromWayId: number | null,
  toWayId: number | null,
  junctionNodeId: number | null = null,
): TurnRestrictionResult {
  if (!fromWayId || !toWayId || !restrictions?.length) {
    return { decision: 'unresolved', matchedRestrictionIds: [], reason: 'restriction data unavailable', confidence: 0.35 };
  }

  const relevant = restrictions.filter((r) =>
    appliesToMotorVehicle(r) &&
    includes(r.from_way_ids, fromWayId) &&
    (!r.via_node_ids?.length || includes(r.via_node_ids, junctionNodeId))
  );
  if (!relevant.length) {
    return { decision: 'allowed', matchedRestrictionIds: [], reason: 'no matching OSM restriction', confidence: 0.95 };
  }

  const simple = relevant.filter((r) => !(r.via_way_ids?.length));
  const complex = relevant.filter((r) => (r.via_way_ids?.length ?? 0) > 0);
  const only = simple.filter((r) => isOnlyRestriction(r.restriction));
  const no = simple.filter((r) => isNoRestriction(r.restriction));

  if (only.length && !only.some((r) => includes(r.to_way_ids, toWayId))) {
    return { decision: 'prohibited', matchedRestrictionIds: only.map((r) => r.osm_id), reason: 'OSM only-turn restriction excludes this outgoing way', confidence: 1 };
  }
  const blocked = no.filter((r) => includes(r.to_way_ids, toWayId));
  if (blocked.length) {
    return { decision: 'prohibited', matchedRestrictionIds: blocked.map((r) => r.osm_id), reason: 'OSM no-turn restriction blocks this outgoing way', confidence: 1 };
  }
  if (complex.length) {
    return { decision: 'unresolved', matchedRestrictionIds: complex.map((r) => r.osm_id), reason: 'multi-way OSM restriction requires route-sequence context', confidence: 0.55 };
  }
  return { decision: 'allowed', matchedRestrictionIds: relevant.map((r) => r.osm_id), reason: 'OSM restrictions do not prohibit this transition', confidence: 0.95 };
}

/**
 * Evaluates the next way against both simple and multi-way OSM restrictions.
 * `traversedWayIds` should contain the ordered route way history ending at the
 * current incoming way. This is enough to enforce common from -> via way -> to
 * relations without guessing from geometry alone.
 */
export function evaluateNextWayRestriction(
  restrictions: SceneRestriction[] | undefined,
  traversedWayIds: number[],
  candidateToWayId: number | null,
  junctionNodeId: number | null = null,
): TurnRestrictionResult {
  if (!candidateToWayId || !restrictions?.length || !traversedWayIds.length) {
    return { decision: 'unresolved', matchedRestrictionIds: [], reason: 'restriction sequence unavailable', confidence: 0.35 };
  }

  const fromWayId = traversedWayIds[traversedWayIds.length - 1] ?? null;
  const simple = evaluateTurnRestriction(restrictions, fromWayId, candidateToWayId, junctionNodeId);
  if (simple.decision === 'prohibited') return simple;

  const complex = restrictions.filter((r) =>
    appliesToMotorVehicle(r) &&
    (r.via_way_ids?.length ?? 0) > 0 &&
    r.from_way_ids?.length === 1 &&
    r.to_way_ids?.length === 1
  );

  const prohibited: number[] = [];
  const onlyMatched: number[] = [];
  const onlyCandidates: SceneRestriction[] = [];

  for (const r of complex) {
    const expectedPrefix = [r.from_way_ids![0], ...(r.via_way_ids ?? [])];
    if (!sequenceMatchesPrefix(traversedWayIds, expectedPrefix)) continue;
    if (r.via_node_ids?.length && !r.via_node_ids.includes(junctionNodeId ?? -1)) continue;
    if (isNoRestriction(r.restriction) && r.to_way_ids!.includes(candidateToWayId)) prohibited.push(r.osm_id);
    if (isOnlyRestriction(r.restriction)) {
      onlyMatched.push(r.osm_id);
      onlyCandidates.push(r);
    }
  }

  if (onlyCandidates.length && !onlyCandidates.some((r) => r.to_way_ids!.includes(candidateToWayId))) {
    return { decision: 'prohibited', matchedRestrictionIds: onlyMatched, reason: 'multi-way OSM only restriction excludes this continuation', confidence: 1 };
  }
  if (prohibited.length) {
    return { decision: 'prohibited', matchedRestrictionIds: prohibited, reason: 'multi-way OSM restriction blocks this continuation', confidence: 1 };
  }

  const unresolved = complex.some((r) =>
    r.from_way_ids?.includes(fromWayId ?? -1) &&
    (r.via_way_ids?.length ?? 0) > 0 &&
    !sequenceMatchesPrefix(traversedWayIds, [r.from_way_ids![0], ...(r.via_way_ids ?? [])])
  );
  if (unresolved) return { decision: 'unresolved', matchedRestrictionIds: [], reason: 'multi-way restriction exists but route history does not match', confidence: 0.7 };
  return { decision: simple.decision, matchedRestrictionIds: simple.matchedRestrictionIds, reason: simple.reason, confidence: simple.confidence };
}


/** Segment-aware route-to-way mapping. Kept as the public compatibility entry point
 * while the implementation lives in sceneWayMatcher.ts. */
export function deriveSceneWaySequence(
  routePoints: Array<{ lat: number; lng: number }>,
  roads: SceneRoad[],
  maxDistanceMeters = 35,
): number[] {
  return deriveSegmentSceneWaySequence(routePoints.map((p) => ({ lat: p.lat, lng: p.lng })), roads, maxDistanceMeters);
}

/** Evaluate the whole ordered scene-way route against OSM restrictions. This
 * is intentionally conservative: only a definite prohibition blocks a route;
 * missing/ambiguous relation coverage is reported separately. */
export function evaluateRouteRestrictionTransitions(
  restrictions: SceneRestriction[] | undefined,
  waySequence: number[],
): { prohibited: boolean; matchedRestrictionIds: number[]; unresolvedRestrictionIds: number[]; confidence: number } {
  if (!restrictions?.length || waySequence.length < 2) {
    return { prohibited: false, matchedRestrictionIds: [], unresolvedRestrictionIds: [], confidence: 0.6 };
  }
  const matched: number[] = [];
  const unresolved: number[] = [];
  for (let i = 1; i < waySequence.length; i += 1) {
    const history = waySequence.slice(Math.max(0, i - 8), i);
    const result = evaluateNextWayRestriction(restrictions, history, waySequence[i]);
    if (result.decision === 'prohibited') matched.push(...result.matchedRestrictionIds);
    else if (result.decision === 'unresolved') unresolved.push(...result.matchedRestrictionIds);
  }
  const unique = (values: number[]) => [...new Set(values)];
  return {
    prohibited: matched.length > 0,
    matchedRestrictionIds: unique(matched),
    unresolvedRestrictionIds: unique(unresolved),
    confidence: matched.length ? 1 : unresolved.length ? 0.7 : 0.95,
  };
}
