import { describe, expect, it } from 'vitest';
import { buildSpatialMemorySnapshot, predictSpatialMemory } from './spatialMemory';
import { SpatialObservation } from './observationLedger';

const base = Date.UTC(2026, 8, 9, 12, 0, 0);
function obs(type: SpatialObservation['type'], offsetHours: number, confidence = 0.9): SpatialObservation {
  return { id: `${type}-${offsetHours}`, at: base - offsetHours * 3600000, type, routeGeneration: 1, maneuverKey: null, wayId: 42, maneuver: 'turn', laneAlignment: type === 'lane_misalignment' ? 'misaligned' : 'unknown', confidence };
}

describe('spatial memory', () => {
  it('raises prediction from repeated recent failures', () => {
    const result = predictSpatialMemory([obs('maneuver_missed', 2), obs('maneuver_missed', 5), obs('lane_misalignment', 8)], 42, null, base);
    expect(result.predictedScore).toBeGreaterThan(50);
    expect(result.recentSampleCount).toBe(3);
    expect(result.signal).not.toBe('stable');
  });

  it('does not create confidence from an unknown road', () => {
    const result = predictSpatialMemory([], 99, null, base);
    expect(result.predictedScore).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.signal).toBe('stable');
  });

  it('builds a route-wide predictive snapshot', () => {
    const snapshot = buildSpatialMemorySnapshot([42, 43], [obs('maneuver_missed', 1), obs('hazard_observed', 3)], new Map(), 42, base);
    expect(snapshot.routePredictions).toHaveLength(2);
    expect(snapshot.current.wayId).toBe(42);
    expect(snapshot.difficultAhead).toBeGreaterThanOrEqual(0);
  });
});
