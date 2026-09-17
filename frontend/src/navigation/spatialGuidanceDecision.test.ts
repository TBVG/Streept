import { describe, expect, it } from 'vitest';
import { decideSpatialGuidance } from './spatialGuidanceDecision';
import { SpatialIntelligenceSnapshot } from './spatialIntelligence';

const base: SpatialIntelligenceSnapshot = {
  roadClass: 'arterial', roadName: 'Main St', wayId: 1, laneCount: 2, oneWay: true,
  speedLimitKph: 50, maneuver: 'none', maneuverDistanceMeters: null, nextManeuver: null,
  nearbySignals: 0, nearbyCrossings: 0, nearbyStops: 0, nearbyReports: 0, nearbyTrafficVehicles: 0, confidence: 0.9,
};

describe('decideSpatialGuidance', () => {
  it('does not invent guidance when spatial confidence is low', () => {
    expect(decideSpatialGuidance({ ...base, confidence: 0.2 }).action).toBe('uncertain');
  });
  it('prepares for an approaching turn', () => {
    const result = decideSpatialGuidance({ ...base, maneuver: 'turn', maneuverDistanceMeters: 90 });
    expect(result.action).toBe('prepare');
  });
  it('raises priority for a complex maneuver', () => {
    const result = decideSpatialGuidance({ ...base, maneuver: 'roundabout', maneuverDistanceMeters: 60 });
    expect(result.action).toBe('high-alert');
    expect(result.priority).toBe('critical');
  });
  it('requests slowing only when a known speed limit is exceeded', () => {
    const result = decideSpatialGuidance({ ...base }, 16);
    expect(result.action).toBe('slow');
    expect(result.targetSpeedMps).toBeCloseTo(50 / 3.6);
  });
  it('does not manufacture a speed target when no speed limit exists', () => {
    const result = decideSpatialGuidance({ ...base, speedLimitKph: null }, 30);
    expect(result.targetSpeedMps).toBeNull();
    expect(result.action).toBe('continue');
  });
});
