import { describe, expect, it } from 'vitest';
import { ManeuverOutcomeTracker } from './maneuverOutcome';
import { SpatialIntelligenceSnapshot } from './spatialIntelligence';

function spatial(distance: number | null, alignment: 'aligned' | 'misaligned' | 'unknown' = 'aligned'): SpatialIntelligenceSnapshot {
  return {
    roadClass: 'arterial', roadName: 'Main', wayId: 1, laneCount: 2, oneWay: true, speedLimitKph: 50,
    maneuver: distance == null ? 'none' : 'turn', maneuverDistanceMeters: distance,
    nextManeuver: distance == null ? null : { type: 'turn', modifier: 'right', location: { lat: 1, lng: 2 }, bearing_before: 0, instruction: 'Turn right', is_complex: false },
    nearbySignals: 0, nearbyCrossings: 0, nearbyStops: 0, nearbyReports: 0, nearbyTrafficVehicles: 0,
    hazardIntelligence: { level: 'none', confidence: 0.9, nearbyHazards: 0, nearbyClosedLanes: 0 },
    laneIntelligence: { currentLaneIndex: 1, recommendedLaneIndices: [1], laneAlignment: alignment, laneChangeDirection: 'stay', requiredLaneChanges: 0, confidence: 0.9 },
    confidence: 0.9,
  };
}

describe('maneuver outcome tracker', () => {
  it('requires an approach before marking a maneuver completed', () => {
    const tracker = new ManeuverOutcomeTracker();
    tracker.update({ spatial: spatial(80), routeGeneration: 1 });
    tracker.update({ spatial: spatial(20), routeGeneration: 1 });
    const result = tracker.update({ spatial: spatial(40), routeGeneration: 1 });
    expect(result.status).toBe('completed');
    expect(result.completedCount).toBe(1);
    expect(result.laneCompliant).toBe(true);
  });

  it('marks a maneuver missed when the active maneuver changes without an approach', () => {
    const tracker = new ManeuverOutcomeTracker();
    tracker.update({ spatial: spatial(80), routeGeneration: 1 });
    const result = tracker.update({ spatial: { ...spatial(70), nextManeuver: { type: 'turn', modifier: 'left', location: { lat: 3, lng: 4 }, bearing_before: 0, instruction: 'Turn left', is_complex: false } }, routeGeneration: 1 });
    expect(result.status).toBe('missed');
    expect(result.missedCount).toBe(1);
  });

  it('resets counters when the route generation changes', () => {
    const tracker = new ManeuverOutcomeTracker();
    tracker.update({ spatial: spatial(20), routeGeneration: 1 });
    tracker.update({ spatial: spatial(40), routeGeneration: 1 });
    const result = tracker.update({ spatial: spatial(80), routeGeneration: 2 });
    expect(result.completedCount).toBe(0);
    expect(result.missedCount).toBe(0);
  });
});
