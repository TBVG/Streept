import { describe, expect, it } from 'vitest';
import { estimateNavigationEta, getNavigationProgress, isPlausibleLocationFix, matchPosition, projectOntoPolylineNear, smoothLocation } from './navigationCore';
import { decideManeuverExperience, scoreManeuverImportance } from './navigationExperience';

const route = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.01 },
  { lat: 0, lng: 0.02 },
];

describe('navigationCore', () => {
  it('smooths GPS jumps instead of teleporting the vehicle marker', () => {
    const result = smoothLocation({ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, 0.5);
    expect(result.lng).toBeCloseTo(0.005, 6);
  });

  it('snaps an on-route GPS point to route geometry', () => {
    const result = matchPosition({ lat: 0.00025, lng: 0.005 }, route);
    expect(result.onRoute).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.location.lng).toBeCloseTo(0.005, 3);
  });

  it('keeps route progress from jumping backwards', () => {
    const first = matchPosition({ lat: 0, lng: 0.012 }, route);
    const second = matchPosition({ lat: 0, lng: 0.008 }, route, first.progressMeters);
    expect(second.progressMeters).toBeGreaterThanOrEqual(first.progressMeters - 18);
  });

  it('keeps repeated matching local to the last route segment', () => {
    const matched = matchPosition({ lat: 0.0001, lng: 0.015 }, route);
    const local = projectOntoPolylineNear({ lat: 0.0001, lng: 0.015 }, route, matched.segmentIndex);
    expect(local).not.toBeNull();
    expect(local!.segmentIndex).toBe(matched.segmentIndex);
  });

  it('uses heading to increase confidence when GPS is near the correct road direction', () => {
    const aligned = matchPosition({ lat: 0.0001, lng: 0.005 }, route, null, 90);
    const opposed = matchPosition({ lat: 0.0001, lng: 0.005 }, route, null, 270);
    expect(aligned.confidence).toBeGreaterThan(opposed.confidence);
  });

  it('detects arrival by destination radius', () => {
    const progress = getNavigationProgress({ lat: 0, lng: 0.02 }, route, { lat: 0, lng: 0.02 }, 2225);
    expect(progress.arrived).toBe(true);
  });

  it('rejects an implausible GPS jump when accuracy is weak', () => {
    expect(isPlausibleLocationFix({
      previous: { lat: 0, lng: 0 },
      next: { lat: 0, lng: 0.1 },
      previousTimestampMs: 1000,
      timestampMs: 2000,
      accuracyMeters: 80,
      reportedSpeedMps: 2,
    })).toBe(false);
  });

  it('accepts a fast but plausible GPS update', () => {
    expect(isPlausibleLocationFix({
      previous: { lat: 0, lng: 0 },
      next: { lat: 0, lng: 0.001 },
      previousTimestampMs: 1000,
      timestampMs: 2000,
      accuracyMeters: 8,
      reportedSpeedMps: 120,
    })).toBe(true);
  });

  it('estimates remaining ETA from route progress and live speed', () => {
    const eta = estimateNavigationEta(5000, 10000, 1200, 20, 1_000_000);
    expect(eta.remainingMeters).toBe(5000);
    expect(eta.remainingSeconds).toBeGreaterThan(200);
    expect(eta.remainingSeconds).toBeLessThan(800);
    expect(eta.arrivalTimeMs).toBeGreaterThan(1_000_000);
  });

  it('returns bounded ETA for stopped navigation instead of Infinity', () => {
    const eta = estimateNavigationEta(5000, 10000, 1200, 0, 1_000_000);
    expect(Number.isFinite(eta.remainingSeconds ?? NaN)).toBe(true);
    expect(eta.remainingSeconds).toBe(600);
  });

});

describe('navigationExperience', () => {
  it('prioritizes complex lane-sensitive maneuvers', () => {
    const simple = { type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 90, instruction: 'Turn right', is_complex: false };
    const complex = { ...simple, type: 'roundabout', is_complex: true, lanes: [{ indications: ['right'], valid: true }] };
    expect(scoreManeuverImportance(complex)).toBeGreaterThan(scoreManeuverImportance(simple));
  });

  it('opens the immersive experience earlier at higher speed', () => {
    const maneuver = { type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 90, instruction: 'Turn right', is_complex: true };
    const slow = decideManeuverExperience(maneuver, 5, 180);
    const fast = decideManeuverExperience(maneuver, 25, 500);
    expect(fast.preloadDistanceMeters).toBeGreaterThan(slow.preloadDistanceMeters);
  });
});
