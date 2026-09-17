import { assessLaneChangeTrafficSafety } from './laneChangeTrafficSafety';
import { LaneChangeTrajectory } from './laneChangeTrajectory';

const trajectory: LaneChangeTrajectory = {
  sourceLane: 0, targetLane: 1,
  points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.0002 }],
  lengthMeters: 22, lateralShiftMeters: 3.5, startFraction: 0, endFraction: 1,
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


  it('uses longitudinal gap at the merge point rather than only 2-D proximity', () => {
    const ahead = assessLaneChangeTrafficSafety({
      trajectory, targetLane: 1,
      occupants: [{ id: 'ahead', location: { lat: 0, lng: 0.00009 }, laneIndex: 1, confidence: 0.95 }],
    });
    expect(ahead.safe).toBe(false);
    expect(ahead.gapAheadMeters).not.toBeNull();

    const farther = assessLaneChangeTrafficSafety({
      trajectory, targetLane: 1,
      occupants: [{ id: 'far', location: { lat: 0, lng: 0.0002 }, laneIndex: 1, confidence: 0.95 }],
      cautionDistanceMeters: 20,
    });
    expect(farther.safe).toBe(true);
    expect(farther.gapAheadMeters).toBeGreaterThan(5);
  });


  it('predicts conflict anywhere along the maneuver, not only at the midpoint', () => {
    const longTrajectory: LaneChangeTrajectory = {
      ...trajectory,
      points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.00045 }],
      lengthMeters: 50,
    };
    const result = assessLaneChangeTrafficSafety({
      trajectory: longTrajectory, targetLane: 1, egoSpeedMps: 10,
      occupants: [{
        id: 'approaching', location: { lat: 0, lng: 0.00001 }, laneIndex: 1,
        speedMps: 7, headingDegrees: 90, confidence: 0.95,
      }],
      cautionDistanceMeters: 20,
    });
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('unsafe-gap');
    expect(result.timeToConflictSeconds).not.toBeNull();
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

  it('blocks a faster vehicle closing from behind even when the static gap is large', () => {
    const result = assessLaneChangeTrafficSafety({
      trajectory, targetLane: 1, egoSpeedMps: 10, egoHeadingDegrees: 90,
      occupants: [{ id: 'closing', location: { lat: 0, lng: -0.00005 }, laneIndex: 1, speedMps: 20, headingDegrees: 90, confidence: 0.95 }],
    });
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('unsafe-gap');
    expect(result.timeToConflictSeconds).not.toBeNull();
  });

  it('does not block a faster vehicle ahead that is pulling away', () => {
    const result = assessLaneChangeTrafficSafety({
      trajectory, targetLane: 1, egoSpeedMps: 10, egoHeadingDegrees: 90,
      occupants: [{ id: 'pulling-away', location: { lat: 0, lng: 0.0002 }, laneIndex: 1, speedMps: 20, headingDegrees: 90, confidence: 0.95 }],
      cautionDistanceMeters: 25,
    });
    expect(result.safe).toBe(true);
    expect(result.timeToConflictSeconds).toBeNull();
  });
