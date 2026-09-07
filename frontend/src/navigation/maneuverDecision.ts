import { DestinationLaneTiming } from './destinationLaneIntelligence';
import { LaneChangeReachability } from './laneChangeReachability';

export type ManeuverDecisionAction = 'hold' | 'prepare' | 'change-now' | 'uncertain' | 'reroute';

export interface UnifiedManeuverDecisionInput {
  timing: DestinationLaneTiming | null;
  reachability: LaneChangeReachability | null;
  currentLaneConfidence: number;
  distanceToManeuverMeters: number;
}

export interface UnifiedManeuverDecision {
  action: ManeuverDecisionAction;
  safe: boolean;
  confidence: number;
  targetLaneIndex: number | null;
  direction: DestinationLaneTiming['direction'];
  reason: string;
  recommendedSpeedMps: number | null;
}

/**
 * Single policy layer for lane-changing. Geometry, vehicle dynamics, traffic,
 * GPS confidence and maneuver timing are already calculated by their domain
 * modules; this function decides what the driver-facing execution layer should
 * do with those signals. It deliberately never invents traffic or geometry.
 */
export function decideUnifiedManeuver(input: UnifiedManeuverDecisionInput): UnifiedManeuverDecision {
  const timing = input.timing;
  if (!timing || timing.laneChanges === 0 || timing.targetLaneIndex == null) {
    return { action: 'hold', safe: true, confidence: Math.max(0, Math.min(1, input.currentLaneConfidence)), targetLaneIndex: timing?.targetLaneIndex ?? null, direction: 'stay', reason: 'same-lane', recommendedSpeedMps: null };
  }

  const reachability = input.reachability;
  const confidenceInputs = [timing.confidence, input.currentLaneConfidence, reachability?.confidence ?? 0];
  const confidence = confidenceInputs.every(Number.isFinite)
    ? Math.max(0, Math.min(1, Math.min(...confidenceInputs)))
    : 0;
  const urgency = String(timing.urgency).trim().toLowerCase();
  const reason = reachability?.trafficReason || reachability?.reason || 'low-confidence';
  const recommendedSpeedMps = reachability?.dynamics?.recommendedSpeedMps ?? null;

  // Timing deadlines take precedence over the generic preparation path, but
  // never override the hard reachability/safety gate.
  if (urgency === 'too-late' || timing.latestChangeMeters <= 0) {
    return { action: 'reroute', safe: false, confidence, targetLaneIndex: timing.targetLaneIndex, direction: timing.direction, reason: 'too-late', recommendedSpeedMps };
  }

  if (urgency === 'change-now') {
    if (reachability?.reachable && confidence >= 0.35) {
      return { action: 'change-now', safe: true, confidence, targetLaneIndex: timing.targetLaneIndex, direction: timing.direction, reason: 'reachable-and-timed', recommendedSpeedMps };
    }
    const recoverable = input.distanceToManeuverMeters > Math.max(20, (reachability?.requiredRunwayMeters ?? 0) * 0.55);
    return { action: recoverable ? 'uncertain' : 'reroute', safe: false, confidence, targetLaneIndex: timing.targetLaneIndex, direction: timing.direction, reason: reason || 'low-confidence', recommendedSpeedMps };
  }

  if (!reachability || !reachability.reachable) {
    const recoverable = input.distanceToManeuverMeters > Math.max(20, (reachability?.requiredRunwayMeters ?? 0) * 0.55);
    return {
      action: recoverable ? 'uncertain' : 'reroute',
      safe: false,
      confidence,
      targetLaneIndex: timing.targetLaneIndex,
      direction: timing.direction,
      reason,
      recommendedSpeedMps,
    };
  }
  return { action: 'prepare', safe: true, confidence, targetLaneIndex: timing.targetLaneIndex, direction: timing.direction, reason: 'prepare-for-lane-change', recommendedSpeedMps };
}
