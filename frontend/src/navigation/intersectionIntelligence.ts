import { Maneuver, SceneRoad } from '../types';
import { classifyJunctionBehavior, JunctionBehavior, laneChangeWindowBufferMeters } from './junctionBehavior';

export interface IntersectionIntelligence {
  kind: JunctionBehavior['intersection'];
  behavior: JunctionBehavior['kind'];
  complexity: 'simple' | 'complex';
  priority: JunctionBehavior['priority'];
  laneCommitmentRequired: boolean;
  laneChangeAllowedBeforeJunction: boolean;
  laneChangeAllowedInsideJunction: boolean;
  targetLaneBias: JunctionBehavior['targetLaneBias'];
  preparationDistanceMeters: number;
  confidence: number;
}

const COMPLEX_BEHAVIORS = new Set([
  'roundabout-entry', 'roundabout-exit', 'merge', 'split', 'ramp-merge', 'ramp-exit', 'uturn',
]);

export function deriveIntersectionIntelligence(
  maneuver: Maneuver | null,
  incoming: SceneRoad | null,
  outgoing: SceneRoad | null,
  maneuverDistanceMeters: number | null,
): IntersectionIntelligence {
  if (!maneuver) {
    return {
      kind: 'unknown', behavior: 'unknown', complexity: 'simple', priority: 'unknown',
      laneCommitmentRequired: false, laneChangeAllowedBeforeJunction: true,
      laneChangeAllowedInsideJunction: false, targetLaneBias: 'none',
      preparationDistanceMeters: 0, confidence: 0,
    };
  }

  const junction = classifyJunctionBehavior(maneuver, incoming ?? undefined, outgoing ?? undefined);
  const complexity = maneuver.is_complex || COMPLEX_BEHAVIORS.has(junction.kind) ? 'complex' : 'simple';
  const laneChanges = Math.max(0, (maneuver.lanes ?? []).filter((lane) => lane.recommended === false).length);
  const baseBuffer = laneChangeWindowBufferMeters(junction, Math.max(1, laneChanges));
  const preparationDistanceMeters = maneuverDistanceMeters == null
    ? baseBuffer
    : Math.min(Math.max(baseBuffer, 0), Math.max(0, maneuverDistanceMeters));

  return {
    kind: junction.intersection,
    behavior: junction.kind,
    complexity,
    priority: junction.priority,
    laneCommitmentRequired: junction.kind !== 'straight' && junction.kind !== 'unknown',
    laneChangeAllowedBeforeJunction: junction.laneChangeAllowedBeforeJunction,
    laneChangeAllowedInsideJunction: junction.laneChangeAllowedInsideJunction,
    targetLaneBias: junction.targetLaneBias,
    preparationDistanceMeters,
    confidence: Math.max(0, Math.min(1, junction.confidence * (incoming || outgoing ? 1 : 0.78))),
  };
}
