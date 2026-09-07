import { describe, expect, it } from 'vitest';
import { Location } from '../types';
import { replayManeuver } from './maneuverReplay';

const ROUTE: Location[] = [
  { lat: 21.1458, lng: 79.0882 },
  { lat: 21.1467, lng: 79.0892 },
  { lat: 21.1477, lng: 79.0908 },
  { lat: 21.1490, lng: 79.0920 },
  { lat: 21.1502, lng: 79.0937 },
];

describe('maneuver replay', () => {
  it('replays prepare -> changing -> completed', () => {
    const result = replayManeuver({ route: ROUTE, sourceLane: 0, targetLane: 1, maneuverDistanceMeters: 80, speedMps: 10, stepMs: 400 });
    expect(result.failures).toEqual([]);
    expect(result.completed).toBe(true);
    expect(result.frames.some((f) => f.execution.phase === 'prepare')).toBe(true);
    expect(result.frames.some((f) => f.execution.phase === 'changing')).toBe(true);
    expect(result.finalExecution.phase).toBe('completed');
  });

  it('keeps a blocked target lane uncertain and recovers after the blocker clears', () => {
    const result = replayManeuver({ route: ROUTE, sourceLane: 0, targetLane: 1, maneuverDistanceMeters: 80, speedMps: 10, stepMs: 400, blockerWindows: [{ startMs: 1200, endMs: 3600 }] });
    expect(result.blockedFrames).toBeGreaterThan(0);
    expect(result.frames.some((f) => f.execution.phase === 'uncertain')).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.rerouteCount).toBe(0);
  });

  it('reroutes when a blocked maneuver becomes too late', () => {
    const result = replayManeuver({ route: ROUTE, sourceLane: 0, targetLane: 1, maneuverDistanceMeters: 50, speedMps: 12, stepMs: 400, blockerWindows: [{ startMs: 0, endMs: 10000 }] });
    expect(result.blockedFrames).toBeGreaterThan(0);
    expect(result.rerouteCount).toBe(1);
    expect(result.finalNavigationState).toBe('navigating');
  });

  it('uses continuity during GPS dropout and does not falsely complete while confidence is low', () => {
    const result = replayManeuver({ route: ROUTE, sourceLane: 0, targetLane: 1, maneuverDistanceMeters: 80, speedMps: 10, stepMs: 400, dropoutWindowsMs: [{ start: 1600, end: 3600 }] });
    expect(result.dropoutFrames).toBeGreaterThan(0);
    expect(result.frames.some((f) => f.gpsDropout && f.drive.usedContinuity)).toBe(true);
    expect(result.completed).toBe(true);
  });
});
