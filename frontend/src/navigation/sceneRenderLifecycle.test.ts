import { SceneContext } from '../types';
import { buildSceneRenderPlan, diffSceneRenderPlans } from './sceneRenderLifecycle';

const baseScene = (): SceneContext => ({
  buildings: [], signals: [], crossings: [], stops: [], trees: [], restrictions: [], roads: [
    { osm_id: 10, geometry: [{ lat: 1, lng: 2 }, { lat: 1.001, lng: 2.001 }], highway: 'primary', name: 'A', lanes: 2, oneway: true },
  ],
});

test('stable OSM geometry produces a reusable render plan key', () => {
  expect(buildSceneRenderPlan(baseScene()).key).toBe(buildSceneRenderPlan(baseScene()).key);
});

test('plan diff isolates stale scene objects instead of requiring a full reset', () => {
  const first = buildSceneRenderPlan(baseScene());
  const changed = baseScene();
  changed.roads = [...changed.roads, { osm_id: 20, geometry: [{ lat: 1, lng: 2 }, { lat: 1, lng: 2.001 }], highway: 'residential', name: 'B', lanes: 1, oneway: false }];
  const diff = diffSceneRenderPlans(first, buildSceneRenderPlan(changed));
  expect(diff.added.some((object) => object.id.startsWith('road:20:'))).toBe(true);
  expect(diff.unchanged.some((object) => object.id.startsWith('road:10:'))).toBe(true);
  expect(diff.removed).toHaveLength(0);
});

test('changed geometry becomes a replace operation, not an accidental reuse', () => {
  const first = buildSceneRenderPlan(baseScene());
  const changed = baseScene();
  changed.roads[0].geometry = [{ lat: 1, lng: 2 }, { lat: 1.002, lng: 2.002 }];
  const diff = diffSceneRenderPlans(first, buildSceneRenderPlan(changed));
  expect(diff.added).toHaveLength(1);
  expect(diff.removed).toHaveLength(1);
});
