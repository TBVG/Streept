import { LaneChangeReachability } from './laneChangeReachability';
import { StagedLaneChange, stageLaneChange } from './laneChangeStaging';

export type PredictiveLanePlanAction = 'hold' | 'prepare' | 'change-now' | 'wait-for-gap' | 'reroute';

export interface PredictiveLanePlanInput {
  currentLaneIndex: number | null;
  finalTargetLaneIndex: number | null;
  distanceToManeuverMeters: number;
  reachability: LaneChangeReachability | null;
  latestChangeMeters: number;
}

export interface PredictiveLanePlan {
  action: PredictiveLanePlanAction;
  staged: StagedLaneChange;
  immediateTargetLaneIndex: number | null;
  finalTargetLaneIndex: number | null;
  remainingLaneChanges: number;
  safeToExecuteNow: boolean;
  confidence: number;
  reason: string;
}

/**
 * Route-aware lane-step scheduler. It keeps the destination lane as intent but
 * schedules only one adjacent physical move at a time. A blocked step is held
 * while there is still meaningful runway; it becomes a reroute only when the
 * current step can no longer be completed safely.
 */
export function planPredictiveLaneChange(input: PredictiveLanePlanInput): PredictiveLanePlan {
  const staged = stageLaneChange(input.currentLaneIndex, input.finalTargetLaneIndex);
  const baseConfidence = Math.max(0, Math.min(1, Math.min(staged.confidence, input.reachability?.confidence ?? 0)));

  if (staged.immediateTargetLaneIndex == null || staged.remainingLaneChanges === 0) {
    return {
      action: 'hold', staged, immediateTargetLaneIndex: staged.immediateTargetLaneIndex,
      finalTargetLaneIndex: staged.finalTargetLaneIndex, remainingLaneChanges: 0,
      safeToExecuteNow: true, confidence: Math.max(staged.confidence, input.reachability?.confidence ?? 0), reason: 'same-lane',
    };
  }

  const reachability = input.reachability;
  const remaining = input.distanceToManeuverMeters;
  const required = reachability?.requiredRunwayMeters ?? 0;
  const trafficUnsafe = reachability != null && !reachability.trafficSafe;
  const geometryUnsafe = reachability != null && !reachability.reachable && !trafficUnsafe;
  const canStillWait = remaining > Math.max(25, required * 0.75) && input.latestChangeMeters > 0;

  if (reachability?.reachable && reachability.trafficSafe) {
    const action = input.latestChangeMeters <= Math.max(20, required) ? 'change-now' : 'prepare';
    return {
      action, staged, immediateTargetLaneIndex: staged.immediateTargetLaneIndex,
      finalTargetLaneIndex: staged.finalTargetLaneIndex, remainingLaneChanges: staged.remainingLaneChanges,
      safeToExecuteNow: true, confidence: baseConfidence, reason: action === 'change-now' ? 'safe-step-at-deadline' : 'safe-adjacent-step',
    };
  }

  if (trafficUnsafe && canStillWait) {
    return {
      action: 'wait-for-gap', staged, immediateTargetLaneIndex: staged.immediateTargetLaneIndex,
      finalTargetLaneIndex: staged.finalTargetLaneIndex, remainingLaneChanges: staged.remainingLaneChanges,
      safeToExecuteNow: false, confidence: baseConfidence, reason: reachability?.trafficReason || 'unsafe-gap',
    };
  }

  if (!geometryUnsafe && canStillWait) {
    return {
      action: 'wait-for-gap', staged, immediateTargetLaneIndex: staged.immediateTargetLaneIndex,
      finalTargetLaneIndex: staged.finalTargetLaneIndex, remainingLaneChanges: staged.remainingLaneChanges,
      safeToExecuteNow: false, confidence: baseConfidence, reason: reachability?.reason || 'temporarily-unavailable',
    };
  }

  return {
    action: 'reroute', staged, immediateTargetLaneIndex: staged.immediateTargetLaneIndex,
    finalTargetLaneIndex: staged.finalTargetLaneIndex, remainingLaneChanges: staged.remainingLaneChanges,
    safeToExecuteNow: false, confidence: baseConfidence, reason: reachability?.reason || 'step-no-longer-reachable',
  };
}
