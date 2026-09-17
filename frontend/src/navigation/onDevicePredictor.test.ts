import { describe, expect, it } from 'vitest';
import { predictOnDevice } from './onDevicePredictor';
import { SpatialObservation } from './observationLedger';

const observation = (type: SpatialObservation['type'], at: number, confidence = 0.9): SpatialObservation => ({
  id: `${type}-${at}`, at, type, routeGeneration: 1, maneuverKey: null, wayId: 42,
  maneuver: 'turn', laneAlignment: type === 'lane_misalignment' ? 'misaligned' : 'unknown', confidence,
});

describe('on-device predictor', () => {
  it('learns elevated difficulty from repeated misses', () => {
    const now = Date.UTC(2026, 8, 16, 12);
    const items = [0, 1, 2, 3].map((i) => observation('maneuver_missed', now - i * 3_600_000));
    const prediction = predictOnDevice(items, 42, now);
    expect(prediction.samples).toBe(4);
    expect(prediction.score).toBeGreaterThan(50);
    expect(prediction.confidence).toBeGreaterThan(0);
  });

  it('does not invent a prediction for an unknown way', () => {
    const prediction = predictOnDevice([], 999, Date.now());
    expect(prediction).toEqual({ score: 0, confidence: 0, samples: 0 });
  });
});
