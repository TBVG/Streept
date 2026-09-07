import { describe, expect, it } from 'vitest';
import { buildSceneResidencyPlan, sceneObjectIdentity } from './sceneResidency';
import { SceneChunk } from './sceneChunks';

const chunks = (count: number): SceneChunk[] => Array.from({ length: count }, (_, i) => ({
  key: `${i}:0`, center: { lat: i * 0.001, lng: 0 },
  scene: { buildings: [], roads: [], signals: [], crossings: [], stops: [], trees: [], street_lamps: [], restrictions: [] },
}));

describe('scene residency', () => {
  it('keeps current and predictive chunks within the quality budget', () => {
    const plan = buildSceneResidencyPlan(chunks(12), { lat: 0, lng: 0 }, new Set(['0:0', '5:0', '9:0']), ['5:0', '6:0'], ['0:0'], new Map(), 'performance', 1000);
    expect(plan.keepKeys).toContain('0:0');
    expect(plan.keepKeys).toContain('5:0');
    expect(plan.keepKeys.length).toBeLessThanOrEqual(3);
  });
  it('evicts stale existing chunks deterministically', () => {
    const existing = new Set(['0:0', '1:0', '2:0', '9:0']);
    const lastUsed = new Map([['0:0', 900], ['1:0', 100], ['2:0', 800], ['9:0', 50]]);
    const a = buildSceneResidencyPlan(chunks(3), { lat: 0, lng: 0 }, existing, [], ['0:0'], lastUsed, 'balanced', 1000);
    const b = buildSceneResidencyPlan(chunks(3), { lat: 0, lng: 0 }, existing, [], ['0:0'], lastUsed, 'balanced', 1000);
    expect(a).toEqual(b);
    expect(a.evictKeys).toContain('9:0');
  });
  it('produces stable object identities across overlapping bubbles', () => {
    expect(sceneObjectIdentity('road', { osm_id: 42, geometry: [] })).toBe('road:osm:42');
    expect(sceneObjectIdentity('building', { geometry: [{ lat: 1, lng: 2 }, { lat: 1.1, lng: 2.1 }] })).toContain('building:geo:');
  });
});
