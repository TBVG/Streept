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
  const lane = spatial.laneIntelligence ?? { currentLaneIndex: null, recommendedLaneIndices: [], laneAlignment: 'unknown' as const, laneChangeDirection: 'unknown' as const, requiredLaneChanges: 0, confidence: 0 };
  const hazard = spatial.hazardIntelligence ?? { level: 'none' as const, nearbyCriticalReports: 0, nearbyTrafficJams: 0, nearbyClosedLanes: 0, confidence: 0 };
  const intersection = spatial.intersectionIntelligence ?? { complexity: 'simple' as const, preparationDistanceMeters: 0, behavior: 'unknown' as const, confidence: 0 };
  const baseConfidence = clamp01(Math.min(spatial.confidence, guidance.confidence));

  if (input.restrictionProhibited && input.restrictionConfidence >= 0.65) {
    return {
      action: 'reroute', priority: 'critical', confidence: clamp01(input.restrictionConfidence),
      reason: 'prohibited-turn-or-route-restriction', targetSpeedMps: null,
      laneChangeDirection: 'unknown', targetLaneIndex: null,
    };
  }

  if (hazard.level === 'critical') {
    return {
      action: 'high-alert', priority: 'critical',
      confidence: clamp01(Math.min(baseConfidence || 1, hazard.confidence || baseConfidence)),
      reason: hazard.nearbyClosedLanes > 0 ? 'closed-lane-nearby' : 'road-hazard-nearby',
      targetSpeedMps: guidance.targetSpeedMps,
      laneChangeDirection: lane.laneChangeDirection,
      targetLaneIndex: lane.recommendedLaneIndices[0] ?? null,
    };
  }

  if (intersection.complexity === 'complex' &&
      intersection.preparationDistanceMeters > 0 &&
      spatial.maneuverDistanceMeters != null &&
      spatial.maneuverDistanceMeters <= intersection.preparationDistanceMeters) {
    return {
      action: 'prepare', priority: 'elevated',
      confidence: clamp01(Math.min(baseConfidence, intersection.confidence)),
      reason: `complex-${intersection.behavior}-approach`,
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
