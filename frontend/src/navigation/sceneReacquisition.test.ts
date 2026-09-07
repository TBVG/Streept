import { describe, expect, it } from 'vitest';
import { buildSceneReacquisitionPlan } from './sceneReacquisition';
import { SceneChunk } from './sceneChunks';

const chunks = (count: number): SceneChunk[] => Array.from({ length: count }, (_, i) => ({
  key: `${i}:0`, center: { lat: i * 0.001, lng: 0 }, scene: { buildings: [], roads: [], signals: [], crossings: [], stops: [], trees: [], street_lamps: [], restrictions: [] },
}));

describe('scene reacquisition', () => {
  it('limits desired bubbles by quality budget', () => {
    const plan = buildSceneReacquisitionPlan(chunks(10), { lat: 0, lng: 0 }, null, new Set(), new Set(), 'performance');
    expect(plan.desiredKeys).toHaveLength(3);
  });
  it('warms a new bubble while preserving an existing bubble for handoff', () => {
    const plan = buildSceneReacquisitionPlan(chunks(4), { lat: 0.0015, lng: 0 }, { lat: 0, lng: 0 }, new Set(['0:0']), new Set(), 'high');
    expect(plan.items.some((x) => x.state === 'warming')).toBe(true);
    expect(plan.items.some((x) => x.state === 'handoff')).toBe(true);
  });
  it('marks stale desired bubbles for reacquisition', () => {
    const plan = buildSceneReacquisitionPlan(chunks(2), { lat: 0, lng: 0 }, null, new Set(['0:0']), new Set(['0:0']), 'high');
    expect(plan.items.find((x) => x.key === '0:0')?.state).toBe('stale');
  });
  it('keeps the nearest chunk primary', () => {
    const plan = buildSceneReacquisitionPlan(chunks(4), { lat: 0.0011, lng: 0 }, null, new Set(), new Set(), 'high');
    expect(plan.primaryKey).toBe('1:0');
  });
});
