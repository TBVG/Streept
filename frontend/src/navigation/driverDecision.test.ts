import { describe, expect, it } from 'vitest';
import { decideDriverAction } from './driverDecision';
import { SpatialIntelligenceSnapshot } from './spatialIntelligence';
import { SpatialGuidanceDecision } from './spatialGuidanceDecision';

const spatial = (overrides: Partial<SpatialIntelligenceSnapshot> = {}): SpatialIntelligenceSnapshot => ({
  roadClass: 'arterial', roadName: 'Main', wayId: 1, laneCount: 3, oneWay: true, speedLimitKph: 50,
  maneuver: 'turn', maneuverDistanceMeters: 100, nextManeuver: null, nearbySignals: 0, nearbyCrossings: 0,
  nearbyStops: 0, nearbyReports: 0, nearbyTrafficVehicles: 0,
  hazardIntelligence: { level: 'none', nearbyCriticalReports: 0, nearbyTrafficJams: 0, nearbyClosedLanes: 0, confidence: 0 },
  laneIntelligence: { currentLaneIndex: 0, recommendedLaneIndices: [1], laneAlignment: 'misaligned', laneChangeDirection: 'right', requiredLaneChanges: 1, confidence: 0.9 },
  confidence: 0.9, ...overrides,
});
const guidance: SpatialGuidanceDecision = { action: 'prepare', confidence: 0.9, priority: 'elevated', reason: 'maneuver-ahead', targetSpeedMps: null };

describe('driver decision', () => {
  it('prioritizes a verified route restriction', () => {
    expect(decideDriverAction({ spatial: spatial(), guidance, restrictionProhibited: true, restrictionConfidence: 0.9, routeReacquire: false }).action).toBe('reroute');
  });
  it('prioritizes observed hazards over lane preparation', () => {
    const s = spatial({ hazardIntelligence: { level: 'critical', nearbyCriticalReports: 1, nearbyTrafficJams: 0, nearbyClosedLanes: 1, confidence: 0.8 } });
    expect(decideDriverAction({ spatial: s, guidance, restrictionProhibited: false, restrictionConfidence: 0, routeReacquire: false }).action).toBe('high-alert');
  });
  it('emits lane change when lane intelligence is actionable', () => {
    expect(decideDriverAction({ spatial: spatial(), guidance, restrictionProhibited: false, restrictionConfidence: 0, routeReacquire: false }).action).toBe('lane-change');
  });
});
