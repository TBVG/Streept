import { describe, expect, it } from 'vitest';
import { assessLaneChangeDynamics } from './laneChangeDynamics';
import { LaneChangeTrajectory } from './laneChangeTrajectory';

const trajectory = (overrides: Partial<LaneChangeTrajectory> = {}): LaneChangeTrajectory => ({
  sourceLane: 0, targetLane: 1, points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.0005 }], lengthMeters: 55,
  lateralShiftMeters: 3.5, startFraction: 0, endFraction: 1, confidence: 0.92, reachable: true, reason: 'physical', ...overrides,
});

describe('lane change vehicle dynamics', () => {
  it('accepts a comfortable-speed lane change with ample runway', () => {
    const result = assessLaneChangeDynamics({ trajectory: trajectory(), currentSpeedMps: 8, distanceToManeuverMeters: 100 });
    expect(result.safe).toBe(true);
    expect(result.reason).toBe('safe');
    expect(result.recommendedSpeedMps).toBeGreaterThan(8);
  });

  it('rejects a high-speed change when there is not enough distance to react and slow', () => {
    const result = assessLaneChangeDynamics({ trajectory: trajectory(), currentSpeedMps: 30, distanceToManeuverMeters: 65 });
    expect(result.safe).toBe(false);
    expect(['insufficient-reaction-distance', 'lateral-load-too-high']).toContain(result.reason);
  });

  it('allows the same high-speed vehicle more runway to slow before changing', () => {
    const result = assessLaneChangeDynamics({ trajectory: trajectory(), currentSpeedMps: 30, distanceToManeuverMeters: 230 });
    expect(result.safe).toBe(true);
    expect(result.recommendedSpeedMps).toBeLessThan(30);
    expect(result.brakingDistanceMeters).toBeGreaterThan(0);
  });

  it('penalizes a two-lane shift with a lower recommended speed', () => {
    const one = assessLaneChangeDynamics({ trajectory: trajectory({ lateralShiftMeters: 3.5 }), currentSpeedMps: 12, distanceToManeuverMeters: 120 });
    const two = assessLaneChangeDynamics({ trajectory: trajectory({ targetLane: 2, lateralShiftMeters: 7 }), currentSpeedMps: 12, distanceToManeuverMeters: 120 });
    expect(two.recommendedSpeedMps).toBeLessThan(one.recommendedSpeedMps);
  });
});
