import { SpatialGuidanceDecision } from './spatialGuidanceDecision';
import { SpatialIntelligenceSnapshot } from './spatialIntelligence';

export type DriverDecisionAction =
  | 'continue'
  | 'prepare'
  | 'slow'
  | 'high-alert'
  | 'lane-change'
  | 'uncertain'
  | 'reroute';

export interface DriverDecisionInput {
  spatial: SpatialIntelligenceSnapshot;
  guidance: SpatialGuidanceDecision;
  restrictionProhibited: boolean;
  restrictionConfidence: number;
  routeReacquire: boolean;
}

export interface DriverDecision {
  action: DriverDecisionAction;
  priority: 'normal' | 'elevated' | 'critical';
  confidence: number;
  reason: string;
  targetSpeedMps: number | null;
  laneChangeDirection: 'left' | 'right' | 'stay' | 'unknown';
  targetLaneIndex: number | null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/**
 * Canonical driver-facing policy. Domain modules calculate facts; this layer
 * resolves them into one conservative action without inventing map facts.
 */
export function decideDriverAction(input: DriverDecisionInput): DriverDecision {
  const spatial = input.spatial;
  const guidance = input.guidance;
  const lane = spatial.laneIntelligence;
  const baseConfidence = clamp01(Math.min(spatial.confidence, guidance.confidence));

  if (input.restrictionProhibited && input.restrictionConfidence >= 0.65) {
    return {
      action: 'reroute', priority: 'critical', confidence: clamp01(input.restrictionConfidence),
      reason: 'prohibited-turn-or-route-restriction', targetSpeedMps: null,
      laneChangeDirection: 'unknown', targetLaneIndex: null,
    };
  }

  if (spatial.hazardIntelligence.level === 'critical') {
    return {
      action: 'high-alert', priority: 'critical',
      confidence: clamp01(Math.min(baseConfidence || 1, spatial.hazardIntelligence.confidence || baseConfidence)),
      reason: spatial.hazardIntelligence.nearbyClosedLanes > 0 ? 'closed-lane-nearby' : 'road-hazard-nearby',
      targetSpeedMps: guidance.targetSpeedMps,
      laneChangeDirection: lane.laneChangeDirection,
      targetLaneIndex: lane.recommendedLaneIndices[0] ?? null,
    };
  }

  if (spatial.intersectionIntelligence.complexity === 'complex' &&
      spatial.intersectionIntelligence.preparationDistanceMeters > 0 &&
      spatial.maneuverDistanceMeters != null &&
      spatial.maneuverDistanceMeters <= spatial.intersectionIntelligence.preparationDistanceMeters) {
    return {
      action: 'prepare', priority: 'elevated',
      confidence: clamp01(Math.min(baseConfidence, spatial.intersectionIntelligence.confidence)),
      reason: `complex-${spatial.intersectionIntelligence.behavior}-approach`,
      targetSpeedMps: guidance.targetSpeedMps,
      laneChangeDirection: lane.laneChangeDirection,
      targetLaneIndex: lane.recommendedLaneIndices[0] ?? null,
    };
  }

  if (input.routeReacquire || guidance.action === 'uncertain' || baseConfidence < 0.35) {
    return {
      action: 'uncertain', priority: 'elevated', confidence: baseConfidence,
      reason: input.routeReacquire ? 'route-reacquisition' : 'limited-spatial-confidence',
      targetSpeedMps: null, laneChangeDirection: lane.laneChangeDirection,
      targetLaneIndex: lane.recommendedLaneIndices[0] ?? null,
    };
  }

  if (lane.laneAlignment === 'misaligned' && lane.requiredLaneChanges > 0 && lane.confidence >= 0.55) {
    return {
      action: 'lane-change', priority: 'elevated', confidence: clamp01(Math.min(baseConfidence, lane.confidence)),
      reason: 'recommended-lane-change', targetSpeedMps: guidance.targetSpeedMps,
      laneChangeDirection: lane.laneChangeDirection, targetLaneIndex: lane.recommendedLaneIndices[0] ?? null,
    };
  }

  if (guidance.action === 'slow') {
    return { action: 'slow', priority: guidance.priority, confidence: baseConfidence, reason: guidance.reason,
      targetSpeedMps: guidance.targetSpeedMps, laneChangeDirection: lane.laneChangeDirection, targetLaneIndex: lane.recommendedLaneIndices[0] ?? null };
  }

  if (guidance.action === 'high-alert' || guidance.priority === 'critical') {
    return { action: 'high-alert', priority: 'critical', confidence: baseConfidence, reason: guidance.reason,
      targetSpeedMps: guidance.targetSpeedMps, laneChangeDirection: lane.laneChangeDirection, targetLaneIndex: lane.recommendedLaneIndices[0] ?? null };
  }

  if (guidance.action === 'prepare') {
    return { action: 'prepare', priority: 'elevated', confidence: baseConfidence, reason: guidance.reason,
      targetSpeedMps: guidance.targetSpeedMps, laneChangeDirection: lane.laneChangeDirection, targetLaneIndex: lane.recommendedLaneIndices[0] ?? null };
  }

  return { action: 'continue', priority: 'normal', confidence: baseConfidence, reason: 'no-immediate-driver-action',
    targetSpeedMps: null, laneChangeDirection: lane.laneChangeDirection, targetLaneIndex: lane.recommendedLaneIndices[0] ?? null };
}
