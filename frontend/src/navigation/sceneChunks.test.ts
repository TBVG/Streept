import { splitSceneIntoChunks } from './sceneChunks';
import { SceneContext } from '../types';

describe('scene chunks', () => {
  const base: SceneContext = { buildings: [], roads: [], signals: [], crossings: [], stops: [], trees: [], street_lamps: [], restrictions: [] };
  it('groups nearby scene objects into stable spatial chunks', () => {
    const scene = { ...base, roads: [
      { osm_id: 1, geometry: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.0005 }], highway: 'primary', name: null, lanes: 2, oneway: false },
      { osm_id: 2, geometry: [{ lat: 0, lng: 0.01 }, { lat: 0, lng: 0.0105 }], highway: 'primary', name: null, lanes: 2, oneway: false },
    ] } as SceneContext;
    const chunks = splitSceneIntoChunks(scene, { lat: 0, lng: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => c.scene.roads).map((r) => r.osm_id)).toEqual([1, 2]);
  });

  it('keeps an empty scene empty', () => {
    expect(splitSceneIntoChunks(base, { lat: 1, lng: 1 })).toEqual([]);
  });
});
