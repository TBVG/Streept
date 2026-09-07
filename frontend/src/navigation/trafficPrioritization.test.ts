import { describe, expect, it } from 'vitest';
import { prioritizeTrafficCandidates } from './trafficPrioritization';

describe('prioritizeTrafficCandidates', () => {
  it('prefers forward and maneuver-near traffic', () => {
    const result = prioritizeTrafficCandidates([
      { id: 'behind', location: { lat: -0.001, lng: 0 }, headingDegrees: 0, confidence: 1, laneSnapped: false, wayId: null, laneIndex: 2 },
      { id: 'ahead', location: { lat: 0.001, lng: 0 }, headingDegrees: 0, confidence: 1, laneSnapped: false, wayId: null, laneIndex: 1 },
      { id: 'maneuver', location: { lat: 0.0008, lng: 0.0001 }, headingDegrees: 0, confidence: 1, laneSnapped: false, wayId: null, laneIndex: 1 },
    ], { userLocation: { lat: 0, lng: 0 }, userHeadingDegrees: 0, currentLaneIndex: 1, maneuverLocation: { lat: 0.0008, lng: 0.0001 } });
    expect(result[0].id).toBe('maneuver');
    expect(result.findIndex((v) => v.id === 'ahead')).toBeLessThan(result.findIndex((v) => v.id === 'behind'));
  });
});
