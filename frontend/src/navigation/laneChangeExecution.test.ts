import { describe, expect, it } from 'vitest';
import { buildDestinationLaneTiming } from './destinationLaneIntelligence';
import { LaneChangeExecutionTracker } from './laneChangeExecution';

describe('lane change execution', () => {
  it('requires stable target-lane fixes before completion', () => {
    const tracker = new LaneChangeExecutionTracker();
    const timing = buildDestinationLaneTiming(1, 2, 120);
    expect(tracker.update({ currentLaneIndex: 1, currentLaneConfidence: 0.9, timing, distanceToManeuverMeters: 120 }).phase).toBe('prepare');
    expect(tracker.update({ currentLaneIndex: 2, currentLaneConfidence: 0.9, timing, distanceToManeuverMeters: 70 }).phase).toBe('changing');
    expect(tracker.update({ currentLaneIndex: 2, currentLaneConfidence: 0.9, timing, distanceToManeuverMeters: 65 }).phase).toBe('completed');
  });

  it('holds through a low-confidence intermediate fix', () => {
    const tracker = new LaneChangeExecutionTracker();
    const timing = buildDestinationLaneTiming(0, 2, 130);
    tracker.update({ currentLaneIndex: 0, currentLaneConfidence: 0.9, timing, distanceToManeuverMeters: 130 });
    const state = tracker.update({ currentLaneIndex: null, currentLaneConfidence: 0.2, timing, distanceToManeuverMeters: 100 });
    expect(state.phase).toBe('prepare');
    expect(state.stableLane).toBe(0);
  });

  it('marks a missed lane change at the deadline', () => {
    const tracker = new LaneChangeExecutionTracker();
    const timing = buildDestinationLaneTiming(1, 0, 12);
    const state = tracker.update({ currentLaneIndex: 1, currentLaneConfidence: 0.9, timing, distanceToManeuverMeters: 12 });
    expect(state.phase).toBe('missed');
    expect(state.missedReason).toBe('too-late');
  });
});
