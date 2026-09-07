import { budgetSceneContext, routeRenderStride } from './scenePerformance';
import { SceneContext } from '../types';

describe('scene performance budgets', () => {
  const point = (lat: number, lng: number) => ({ lat, lng });
  const scene: SceneContext = {
    roads: Array.from({ length: 220 }, (_, i) => ({ geometry: [point(0, i / 10000), point(0.001, i / 10000)], highway: 'residential', name: null, lanes: 2, oneway: false })),
    buildings: Array.from({ length: 220 }, (_, i) => ({ geometry: [point(0, i / 10000)], height: 8 })),
    signals: Array.from({ length: 40 }, (_, i) => point(0, i / 10000)),
    crossings: Array.from({ length: 40 }, (_, i) => point(0, i / 10000)),
    stops: Array.from({ length: 40 }, (_, i) => point(0, i / 10000)),
    trees: Array.from({ length: 180 }, (_, i) => point(0, i / 10000)),
    street_lamps: Array.from({ length: 100 }, (_, i) => point(0, i / 10000)),
  };

  it('caps dense scene collections deterministically', () => {
    const result = budgetSceneContext(scene, point(0, 0));
    expect(result.roads).toHaveLength(180);
    expect(result.buildings).toHaveLength(180);
    expect(result.trees).toHaveLength(90);
    expect(result.street_lamps).toHaveLength(40);
    expect(result.signals).toHaveLength(24);
    expect(result.crossings).toHaveLength(18);
    expect(result.stops).toHaveLength(18);
  });

  it('increases sampling density for complex maneuvers', () => {
    expect(routeRenderStride(1000, false)).toBe(5);
    expect(routeRenderStride(1000, true)).toBe(4);
  });
});
