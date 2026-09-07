import { describe, expect, it } from 'vitest';
import { LaneTrackingStability } from './laneTrackingStability';

function obs(lane: number, confidence = 0.92, accuracy = 5, wayId = 1) {
  return { laneIndex: lane, confidence, physicalDistanceMeters: 3, headingErrorDegrees: 4, wayId, timestampMs: Date.now(), accuracyMeters: accuracy, speedMps: 12 };
}

describe('LaneTrackingStability', () => {
  it('does not flip lanes on one noisy observation', () => {
    const tracker = new LaneTrackingStability();
    tracker.update(obs(1));
    const decision = tracker.update(obs(2, 0.82));
    expect(decision.laneIndex).toBe(1);
    expect(decision.heldPrevious).toBe(true);
  });

  it('accepts a repeated high-confidence lane change', () => {
    const tracker = new LaneTrackingStability();
    tracker.update(obs(1));
    tracker.update(obs(2));
    const decision = tracker.update(obs(2));
    expect(decision.laneIndex).toBe(2);
    expect(decision.reacquired).toBe(true);
  });

  it('holds the previous lane during poor GPS', () => {
    const tracker = new LaneTrackingStability();
    tracker.update(obs(1));
    const decision = tracker.update(obs(2, 0.9, 28));
    expect(decision.laneIndex).toBe(1);
    expect(decision.reason).toBe('poor-gps');
  });

  it('requires repeated evidence after a way transition', () => {
    const tracker = new LaneTrackingStability();
    tracker.update(obs(1, 0.9, 5, 1));
    const first = tracker.update(obs(2, 0.95, 5, 2));
    expect(first.laneIndex).toBe(1);
    const second = tracker.update(obs(2, 0.95, 5, 2));
    expect(second.laneIndex).toBe(2);
  });
});
