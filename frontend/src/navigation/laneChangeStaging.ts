export interface StagedLaneChange {
  currentLaneIndex: number | null;
  finalTargetLaneIndex: number | null;
  immediateTargetLaneIndex: number | null;
  remainingLaneChanges: number;
  direction: 'stay' | 'left' | 'right';
  staged: boolean;
  confidence: number;
}

/**
 * Converts a multi-lane destination request into adjacent lane steps. The
 * renderer/execution layer should only physically execute immediateTargetLaneIndex;
 * the final target remains available for destination intent and rerouting.
 */
export function stageLaneChange(currentLaneIndex: number | null, finalTargetLaneIndex: number | null): StagedLaneChange {
  if (currentLaneIndex == null || finalTargetLaneIndex == null) {
    return { currentLaneIndex, finalTargetLaneIndex, immediateTargetLaneIndex: finalTargetLaneIndex, remainingLaneChanges: 0, direction: 'stay', staged: false, confidence: 0.5 };
  }
  const delta = finalTargetLaneIndex - currentLaneIndex;
  const remaining = Math.abs(delta);
  if (remaining === 0) {
    return { currentLaneIndex, finalTargetLaneIndex, immediateTargetLaneIndex: currentLaneIndex, remainingLaneChanges: 0, direction: 'stay', staged: false, confidence: 1 };
  }
  const direction = delta < 0 ? 'left' : 'right';
  const immediate = currentLaneIndex + (delta < 0 ? -1 : 1);
  return {
    currentLaneIndex,
    finalTargetLaneIndex,
    immediateTargetLaneIndex: immediate,
    remainingLaneChanges: remaining,
    direction,
    staged: remaining > 1,
    confidence: remaining > 1 ? 0.9 : 1,
  };
}
