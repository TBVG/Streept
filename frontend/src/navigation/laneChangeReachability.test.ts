import { assessLaneChangeReachability } from './laneChangeReachability';
import { LaneChangeTrajectory } from './laneChangeTrajectory';

const trajectory = (overrides: Partial<LaneChangeTrajectory> = {}): LaneChangeTrajectory => ({
  sourceLane: 0, targetLane: 1, points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }], lengthMeters: 40,
  lateralShiftMeters: 3.3, startFraction: 0, endFraction: 1, confidence: 0.9, reachable: true, reason: 'physical', ...overrides,
});

describe('assessLaneChangeReachability', () => {
  it('accepts a physically reachable change with sufficient runway', () => {
    const result = assessLaneChangeReachability({ trajectory: trajectory(), distanceToManeuverMeters: 60, currentLaneIndex: 0, currentLaneConfidence: 0.9 });
    expect(result.reachable).toBe(true);
    expect(result.reason).toBe('reachable');
  });

  it('rejects a change when the maneuver is too close for the physical trajectory', () => {
    const result = assessLaneChangeReachability({ trajectory: trajectory(), distanceToManeuverMeters: 42, currentLaneIndex: 0, currentLaneConfidence: 0.9 });
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('insufficient-runway');
  });

  it('rejects low-confidence lane state before starting the change', () => {
    const result = assessLaneChangeReachability({ trajectory: trajectory(), distanceToManeuverMeters: 80, currentLaneIndex: 0, currentLaneConfidence: 0.4 });
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('low-confidence');
  });

  it('propagates an unreachable physical trajectory', () => {
    const result = assessLaneChangeReachability({ trajectory: trajectory({ reachable: false, points: [], reason: 'insufficient-runway' }), distanceToManeuverMeters: 80, currentLaneIndex: 0, currentLaneConfidence: 0.9 });
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('insufficient-runway');
  });
});
