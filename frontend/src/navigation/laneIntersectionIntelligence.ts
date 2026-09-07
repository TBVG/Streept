import { LaneInfo, Maneuver, SceneRoad } from '../types';
import { bearingDegrees } from '../utils/geo';

export type IntersectionKind = 'standard' | 'split' | 'merge' | 'roundabout' | 'ramp' | 'bidirectional' | 'unknown';
export type LaneTransitionReason = 'turn-lanes' | 'change-lanes' | 'continuity' | 'heading' | 'fallback';

export interface LegalLaneTransition {
  fromLane: number;
  toLane: number;
  legal: boolean;
  cost: number;
  reason: LaneTransitionReason;
}

export interface IntersectionLanePlan {
  kind: IntersectionKind;
  incomingLanes: number;
  outgoingLanes: number;
  transitions: LegalLaneTransition[];
  targetLane: number | null;
  confidence: number;
}

const norm = (value: string) => value.trim().toLowerCase().replace(/_/g, '-');

function parsePermission(value: string | null | undefined): { left: boolean; right: boolean } {
  if (!value) return { left: true, right: true };
  const v = norm(value);
  if (v === 'no' || v === 'none' || v === 'not') return { left: false, right: false };
  const tokens = v.split(/[;,\s]+/).filter(Boolean);
  const leftOnly = tokens.includes('only:left') || tokens.includes('only-left');
  const rightOnly = tokens.includes('only:right') || tokens.includes('only-right');
  const noLeft = tokens.includes('no:left') || tokens.includes('no-left') || tokens.includes('not:left') || tokens.includes('not-left');
  const noRight = tokens.includes('no:right') || tokens.includes('no-right') || tokens.includes('not:right') || tokens.includes('not-right');
  return { left: !noLeft && !rightOnly, right: !noRight && !leftOnly };
}

function laneChangeAllowed(lane: LaneInfo | undefined, direction: -1 | 1): boolean {
  return direction < 0 ? parsePermission(lane?.change).left : parsePermission(lane?.change).right;
}

export function classifyIntersection(maneuver: Maneuver, incoming?: SceneRoad, outgoing?: SceneRoad): IntersectionKind {
  const type = norm(maneuver.type);
  if (type === 'roundabout' || type === 'rotary') return 'roundabout';
  if (type === 'merge' || type === 'on-ramp' || type === 'off-ramp') return type === 'merge' ? 'merge' : 'ramp';
  const inLanes = incoming?.lanes ?? maneuver.lanes?.length ?? 0;
  const outLanes = outgoing?.lanes ?? 0;
  if (outLanes > inLanes && inLanes > 0) return 'split';
  if (outLanes > 0 && inLanes > outLanes) return 'merge';
  if (incoming?.oneway === false || outgoing?.oneway === false) return 'bidirectional';
  return inLanes > 0 || outLanes > 0 ? 'standard' : 'unknown';
}

/**
 * Build a legal lane transition matrix for one junction. This is deliberately
 * conservative: explicit OSM lane-change tags can forbid adjacent changes;
 * turn-lane indications can forbid using a lane for the maneuver. When tags
 * are absent we allow continuity but lower confidence in the caller.
 */
export function buildLegalLaneTransitions(maneuver: Maneuver, outgoingLaneCount?: number): IntersectionLanePlan {
  const lanes = maneuver.lanes ?? [];
  const incomingLanes = Math.max(0, lanes.length);
  const outgoingLanes = Math.max(0, outgoingLaneCount ?? incomingLanes);
  const transitions: LegalLaneTransition[] = [];

  for (let from = 0; from < incomingLanes; from += 1) {
    for (let to = 0; to < outgoingLanes; to += 1) {
      const delta = to - from;
      const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1;
      let legal = true;
      let reason: LaneTransitionReason = 'continuity';
      let cost = Math.abs(delta);

      if (direction !== 0) {
        legal = laneChangeAllowed(lanes[from], direction as -1 | 1);
        reason = 'change-lanes';
        cost += 0.5;
      }

      const targetIndications = lanes[from]?.indications?.map(norm) ?? [];
      const modifier = maneuver.modifier ? norm(maneuver.modifier) : null;
      const turnMatches = modifier && targetIndications.length
        ? (modifier.includes('left') && targetIndications.some((v) => v.includes('left')))
          || (modifier.includes('right') && targetIndications.some((v) => v.includes('right')))
          || (modifier === 'straight' && targetIndications.some((v) => v === 'through' || v === 'straight'))
          || (modifier === 'uturn' && targetIndications.includes('uturn'))
        : true;
      if (lanes[from]?.valid === false) { legal = false; reason = 'turn-lanes'; }
      if (turnMatches === false && direction === 0) { legal = false; reason = 'turn-lanes'; }
      if (legal && direction !== 0 && Math.abs(delta) > 1) cost += 2;
      transitions.push({ fromLane: from, toLane: to, legal, cost, reason });
    }
  }

  const targetLane = lanes.findIndex((lane) => lane.valid && lane.indications.some((i) => {
    const v = norm(i);
    const m = norm(maneuver.modifier ?? maneuver.type);
    return m.includes('left') ? v.includes('left') : m.includes('right') ? v.includes('right') : m === 'straight' ? v === 'through' || v === 'straight' : v === m;
  }));

  const explicit = lanes.some((lane) => Boolean(lane.change) || Boolean(lane.indications?.length));
  const confidence = incomingLanes === 0 ? 0 : explicit ? 0.92 : 0.68;
  return { kind: classifyIntersection(maneuver), incomingLanes, outgoingLanes, transitions, targetLane: targetLane >= 0 ? targetLane : null, confidence };
}

/** Return a shortest legal sequence of adjacent lane changes. */
export function shortestLegalLaneSequence(plan: IntersectionLanePlan, fromLane: number, targetLane: number): number[] | null {
  if (fromLane < 0 || targetLane < 0 || fromLane >= plan.incomingLanes || targetLane >= plan.outgoingLanes) return null;
  if (fromLane === targetLane) return [fromLane];
  const queue: number[][] = [[fromLane]];
  const visited = new Set([fromLane]);
  while (queue.length) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    for (const next of [current - 1, current + 1]) {
      if (next < 0 || next >= plan.outgoingLanes || visited.has(next)) continue;
      const transition = plan.transitions.find((t) => t.fromLane === current && t.toLane === next);
      if (!transition?.legal) continue;
      if (next === targetLane) return [...path, next];
      visited.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

/**
 * Scores a physical outgoing road against the requested maneuver. The route
 * engine can use this when several OSM ways share a junction node.
 */
export function scoreOutgoingRoad(maneuver: Maneuver, incoming: SceneRoad, outgoing: SceneRoad): number {
  if (outgoing.geometry.length < 2 || incoming.geometry.length < 2) return -Infinity;
  const incomingBearing = bearingDegrees(incoming.geometry[Math.max(0, incoming.geometry.length - 2)], incoming.geometry[incoming.geometry.length - 1]);
  const outgoingBearing = bearingDegrees(outgoing.geometry[0], outgoing.geometry[1]);
  const delta = ((outgoingBearing - incomingBearing + 540) % 360) - 180;
  const modifier = norm(maneuver.modifier ?? '');
  let score = -Math.abs(delta);
  if (modifier.includes('left')) score += delta < -20 ? 100 : -60;
  else if (modifier.includes('right')) score += delta > 20 ? 100 : -60;
  else if (modifier === 'straight') score += Math.abs(delta) < 30 ? 100 : -20;
  if (maneuver.type === 'roundabout' || maneuver.type === 'rotary') score += 20;
  return score;
}
