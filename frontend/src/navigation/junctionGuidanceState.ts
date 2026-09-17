import { IntersectionIntelligence } from './intersectionIntelligence';
import { SpatialLaneIntelligence } from './spatialLaneIntelligence';

export type JunctionGuidancePhase = 'far' | 'prepare' | 'commit' | 'inside' | 'exit' | 'complete';

export interface JunctionGuidanceState {
  phase: JunctionGuidancePhase;
  label: string | null;
  detail: string | null;
  urgency: 'quiet' | 'elevated' | 'high';
  targetLaneIndex: number | null;
  confidence: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function deriveJunctionGuidanceState(
  intersection: IntersectionIntelligence | null | undefined,
  lane: SpatialLaneIntelligence | null | undefined,
  distanceMeters: number | null | undefined,
): JunctionGuidanceState {
  if (!intersection || intersection.behavior === 'unknown' || distanceMeters == null) {
    return { phase: 'far', label: null, detail: null, urgency: 'quiet', targetLaneIndex: null, confidence: 0 };
  }

  const distance = Math.max(0, distanceMeters);
  const prep = Math.max(0, intersection.preparationDistanceMeters);
  const complex = intersection.complexity === 'complex';
  const target = lane?.recommendedLaneIndices?.[0] ?? null;
  const laneChange = lane?.laneChangeDirection && lane.laneChangeDirection !== 'stay' && lane.laneChangeDirection !== 'unknown';
  const confidence = clamp(Math.min(intersection.confidence, lane?.confidence ?? intersection.confidence));
  const behavior = intersection.behavior.replace(/-/g, ' ');

  if (distance <= 8) {
    return {
      phase: 'inside', label: complex ? behavior.toUpperCase() : null,
      detail: intersection.laneChangeAllowedInsideJunction ? 'Stay on the guided path' : 'Hold your lane through the junction',
      urgency: complex ? 'high' : 'elevated', targetLaneIndex: target, confidence,
    };
  }
  if (distance <= 28) {
    return {
      phase: 'commit', label: laneChange ? `COMMIT ${lane?.laneChangeDirection?.toUpperCase()} LANE` : (complex ? behavior.toUpperCase() : null),
      detail: target != null ? `Target lane ${target + 1}` : 'Follow the highlighted route',
      urgency: complex || laneChange ? 'high' : 'elevated', targetLaneIndex: target, confidence,
    };
  }
  if (distance <= Math.max(30, prep)) {
    return {
      phase: 'prepare', label: complex ? `PREPARE · ${behavior.toUpperCase()}` : 'PREPARE FOR TURN',
      detail: target != null ? `Move toward lane ${target + 1}` : 'Follow the highlighted route',
      urgency: 'elevated', targetLaneIndex: target, confidence,
    };
  }
  if (distance <= Math.max(90, prep * 2.2)) {
    return {
      phase: 'far', label: complex ? behavior.toUpperCase() : null,
      detail: complex ? 'Junction ahead' : null,
      urgency: 'quiet', targetLaneIndex: target, confidence: confidence * 0.9,
    };
  }
  return { phase: 'far', label: null, detail: null, urgency: 'quiet', targetLaneIndex: target, confidence: confidence * 0.75 };
}
