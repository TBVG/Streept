import { describe, expect, it } from 'vitest';
import { buildPredictiveScenePrefetchPlan } from './scenePredictivePrefetch';
import { SceneChunk } from './sceneChunks';
import { Route3DHighlight } from '../types';

const route: Route3DHighlight = {
  coordinates: Array.from({ length: 20 }, (_, i) => ({ lat: i * 0.001, lng: 0 })),
  maneuvers: [],
};
const chunks = (count: number): SceneChunk[] => Array.from({ length: count }, (_, i) => ({
  key: `${i}:0`, center: { lat: i * 0.001, lng: 0 },
  scene: { buildings: [], roads: [], signals: [], crossings: [], stops: [], trees: [], street_lamps: [], restrictions: [] },
}));

describe('predictive scene prefetch', () => {
  it('creates forward targets from route and speed', () => {
    const plan = buildPredictiveScenePrefetchPlan(route, { lat: 0, lng: 0 }, 15, [], chunks(20), 'high');
    expect(plan.targets.length).toBeGreaterThan(1);
    expect(plan.targets.some((target) => target.location.lat > 0.001)).toBe(true);
  });
  it('keeps performance mode within a small chunk budget', () => {
    const plan = buildPredictiveScenePrefetchPlan(route, { lat: 0, lng: 0 }, 25, [], chunks(20), 'performance');
    expect(plan.orderedChunkKeys.length).toBeLessThanOrEqual(3);
  });
  it('prioritizes the current/forward corridor over distant chunks', () => {
    const plan = buildPredictiveScenePrefetchPlan(route, { lat: 0.002, lng: 0 }, 10, [], chunks(20), 'balanced');
    expect(plan.primaryChunkKey).toBe('2:0');
  });
  it('remains deterministic while stationary', () => {
    const a = buildPredictiveScenePrefetchPlan(route, { lat: 0.001, lng: 0 }, 0, [], chunks(10), 'high');
    const b = buildPredictiveScenePrefetchPlan(route, { lat: 0.001, lng: 0 }, 0, [], chunks(10), 'high');
    expect(a).toEqual(b);
  });
});
