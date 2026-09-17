import { describe, expect, it } from 'vitest';
import { stageLaneChange } from './laneChangeStaging';

describe('lane change staging', () => {
  it('stages a two-lane move through the adjacent lane', () => {
    const first = stageLaneChange(0, 2);
    expect(first.immediateTargetLaneIndex).toBe(1);
    expect(first.remainingLaneChanges).toBe(2);
    expect(first.staged).toBe(true);
    const second = stageLaneChange(1, 2);
    expect(second.immediateTargetLaneIndex).toBe(2);
    expect(second.remainingLaneChanges).toBe(1);
  });

  it('keeps a one-lane move direct', () => {
    const result = stageLaneChange(2, 1);
    expect(result.immediateTargetLaneIndex).toBe(1);
    expect(result.direction).toBe('left');
    expect(result.staged).toBe(false);
  });

  it('does not invent a target when lane context is missing', () => {
    expect(stageLaneChange(null, 2).immediateTargetLaneIndex).toBe(2);
    expect(stageLaneChange(1, null).immediateTargetLaneIndex).toBe(null);
  });
});
