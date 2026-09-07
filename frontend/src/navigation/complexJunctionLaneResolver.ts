import { Maneuver, SceneRoad } from '../types';
import { mapLaneThroughJunction } from './junctionLaneContinuity';
import { parseOsmLaneSemantics } from './osmLaneSemantics';

export type ComplexJunctionKind = 'merge' | 'split' | 'ramp' | 'slip-lane' | 'close-maneuvers' | 'lane-count-change' | 'ordinary';

export interface ComplexJunctionResolution {
  kind: ComplexJunctionKind;
  targetLaneIndex: number | null;
  confidence: number;
  continuous: boolean;
  reason: string;
  physicalMapping: { fromLane: number; toLane: number; legal: boolean } | null;
}

function laneCount(road: SceneRoad | null): number {
  return Math.max(1, Math.min(8, road?.lanes ?? 1));
}

function highway(road: SceneRoad | null): string {
  return (road?.highway ?? '').toLowerCase();
}

function isRampLike(road: SceneRoad | null): boolean {
  const value = highway(road);
  return value === 'motorway_link' || value === 'trunk_link' || value === 'primary_link' || value === 'secondary_link' || value === 'tertiary_link';
}

function semanticTarget(road: SceneRoad, maneuver: Maneuver, fallback: number | null): number | null {
  const lanes = parseOsmLaneSemantics(road, maneuver, laneCount(road)).filter((lane) => lane.routeScore === 1);
  if (!lanes.length) return fallback;
  return lanes[Math.floor(lanes.length / 2)].index;
}

/**
 * Resolves cases where a plain lane index is an unsafe proxy for physical
 * continuity: merges, splits, ramps/slip lanes and closely-spaced maneuvers.
 * Ambiguous topology lowers confidence rather than manufacturing continuity.
 */
export function resolveComplexJunctionLane(
  fromRoad: SceneRoad | null,
  toRoad: SceneRoad | null,
  maneuver: Maneuver,
  currentLane: number | null,
  proposedTarget: number | null,
  restrictions: import('../types').SceneRestriction[] = [],
  history: number[] = [],
  distanceToNextManeuverMeters: number | null = null,
): ComplexJunctionResolution {
  if (!fromRoad || !toRoad) {
    return { kind: 'ordinary', targetLaneIndex: proposedTarget, confidence: 0.7, continuous: proposedTarget != null, reason: 'missing physical road pair', physicalMapping: null };
  }

  const fromCount = laneCount(fromRoad);
  const toCount = laneCount(toRoad);
  const countChanged = fromCount !== toCount;
  const ramp = isRampLike(toRoad) || isRampLike(fromRoad);
  const close = distanceToNextManeuverMeters != null && distanceToNextManeuverMeters < 80;
  const merge = toCount < fromCount || maneuver.type.toLowerCase().includes('merge');
  const split = toCount > fromCount || maneuver.type.toLowerCase().includes('fork') || maneuver.type.toLowerCase().includes('diverge');
  const kind: ComplexJunctionKind = ramp && (merge || split) ? 'slip-lane' : ramp ? 'ramp' : merge ? 'merge' : split ? 'split' : close ? 'close-maneuvers' : countChanged ? 'lane-count-change' : 'ordinary';

  if (currentLane == null) {
    const semantic = semanticTarget(toRoad, maneuver, proposedTarget);
    return { kind, targetLaneIndex: semantic, confidence: semantic == null ? 0.42 : 0.68, continuous: semantic != null, reason: 'no stable source lane; using downstream semantics only', physicalMapping: null };
  }

  const mapping = mapLaneThroughJunction(fromRoad, toRoad, currentLane, maneuver, restrictions, history);
  if (!mapping || !mapping.legal) {
    return { kind, targetLaneIndex: null, confidence: Math.min(0.35, mapping?.confidence ?? 0.25), continuous: false, reason: mapping?.reason === 'restriction' ? 'turn restriction blocks physical lane continuity' : 'no legal physical lane mapping', physicalMapping: mapping ? { fromLane: currentLane, toLane: mapping.toLane, legal: false } : null };
  }

  const semantic = semanticTarget(toRoad, maneuver, proposedTarget);
  const candidate = semantic ?? mapping.toLane;
  const target = proposedTarget != null && proposedTarget < toCount ? proposedTarget : candidate;
  const mismatch = target == null ? 1 : Math.abs(target - mapping.toLane);
  let confidence = mapping.confidence;
  if (mismatch > 0) confidence *= 0.72;
  if (countChanged) confidence *= 0.9;
  if (ramp) confidence *= 0.9;
  if (close) confidence *= 0.88;

  return {
    kind,
    targetLaneIndex: target,
    confidence: Math.max(0.2, Math.min(0.98, confidence)),
    continuous: target != null && mismatch <= 1,
    reason: mismatch === 0 ? 'physical junction mapping agrees with route lane target' : 'route target differs from physical continuity; confidence reduced',
    physicalMapping: { fromLane: currentLane, toLane: mapping.toLane, legal: mapping.legal },
  };
}
