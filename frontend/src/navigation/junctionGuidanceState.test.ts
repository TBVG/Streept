import { describe, expect, it } from 'vitest';
import { deriveJunctionGuidanceState } from './junctionGuidanceState';

const intersection = {
  kind: 'roundabout' as const, behavior: 'roundabout-entry' as const, complexity: 'complex' as const,
  priority: 'yield' as const, laneCommitmentRequired: true, laneChangeAllowedBeforeJunction: true,
  laneChangeAllowedInsideJunction: false, targetLaneBias: 'none' as const, preparationDistanceMeters: 60, confidence: 0.9,
};
const lane = { currentLaneIndex: 0, recommendedLaneIndices: [1], laneAlignment: 'misaligned' as const, laneChangeDirection: 'right' as const, requiredLaneChanges: 1, confidence: 0.8 };

describe('junctionGuidanceState', () => {
  it('prepares before the junction', () => expect(deriveJunctionGuidanceState(intersection, lane, 50).phase).toBe('prepare'));
  it('commits near the decision point', () => expect(deriveJunctionGuidanceState(intersection, lane, 20).phase).toBe('commit'));
  it('does not recommend a lane change inside a junction', () => {
    const state = deriveJunctionGuidanceState(intersection, lane, 5);
    expect(state.phase).toBe('inside');
    expect(state.detail).toContain('Hold your lane');
  });
  it('stays quiet far away', () => expect(deriveJunctionGuidanceState(intersection, lane, 150).label).toBeNull());
});
