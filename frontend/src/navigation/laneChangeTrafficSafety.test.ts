import { assessLaneChangeTrafficSafety } from './laneChangeTrafficSafety';
import { LaneChangeTrajectory } from './laneChangeTrajectory';

const trajectory: LaneChangeTrajectory = {
  sourceLane: 0, targetLane: 1,
  points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.0001 }],
  lengthMeters: 11, lateralShiftMeters: 3.5, startFraction: 0, endFraction: 1,
  confidence: 0.95, reachable: true, reason: 'physical',
};

describe('lane change traffic safety', () => {
  it('allows a clear target lane', () => {
    expect(assessLaneChangeTrafficSafety({ trajectory, targetLane: 1 }).safe).toBe(true);
  });

  it('blocks a fresh vehicle occupying the target lane', () => {
    const result = assessLaneChangeTrafficSafety({
      trajectory, targetLane: 1,
      occupants: [{ id: 'car-1', location: { lat: 0, lng: 0.00005 }, laneIndex: 1, confidence: 0.95 }],
    });
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('unsafe-gap');
  });

  it('ignores stale target-lane observations', () => {
    const result = assessLaneChangeTrafficSafety({
      trajectory, targetLane: 1, nowMs: 10000,
      occupants: [{ id: 'car-1', location: { lat: 0, lng: 0.00005 }, laneIndex: 1, observedAtMs: 0 }],
    });
    expect(result.safe).toBe(true);
  });

  it('blocks a reported closed lane but only cautions on other hazards', () => {
    const base = { id: 'r', location: { lat: 0, lng: 0.00005 }, photo_url: null, reported_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString(), reporter_id: 'x', confirmations: 1, dismissals: 0 };
    const closed = assessLaneChangeTrafficSafety({ trajectory, targetLane: 1, reports: [{ ...base, type: 'closed_lane' }] });
    const accident = assessLaneChangeTrafficSafety({ trajectory, targetLane: 1, reports: [{ ...base, type: 'accident' }] });
    expect(closed.safe).toBe(false);
    expect(accident.safe).toBe(true);
    expect(accident.reason).toBe('traffic-caution');
  });
});
