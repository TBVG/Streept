import { describe, expect, it } from 'vitest';
import { dedupeSceneObjects, sceneObjectIdentity } from './sceneObjectIdentity';

describe('scene object identity', () => {
  it('prefers stable OSM identity', () => {
    expect(sceneObjectIdentity('road', { osm_id: 42, geometry: [] })).toBe('road:osm:42');
  });

  it('falls back to deterministic geometry identity', () => {
    const a = sceneObjectIdentity('building', { geometry: [{ lat: 1, lng: 2 }, { lat: 1.1, lng: 2.1 }] });
    const b = sceneObjectIdentity('building', { geometry: [{ lat: 1, lng: 2 }, { lat: 1.1, lng: 2.1 }] });
    expect(a).toBe(b);
  });

  it('removes duplicate physical objects from overlapping extracts', () => {
    const result = dedupeSceneObjects({
      buildings: [{ geometry: [{ lat: 1, lng: 2 }, { lat: 1, lng: 2.001 }, { lat: 1.001, lng: 2 }] , height: 8 }, { geometry: [{ lat: 1, lng: 2 }, { lat: 1, lng: 2.001 }, { lat: 1.001, lng: 2 }], height: 9 }],
      roads: [{ osm_id: 7, geometry: [{ lat: 1, lng: 2 }, { lat: 1.001, lng: 2 }], highway: 'primary', name: null, lanes: 2, oneway: false }, { osm_id: 7, geometry: [{ lat: 1, lng: 2 }, { lat: 1.001, lng: 2 }], highway: 'primary', name: null, lanes: 2, oneway: false }],
      signals: [{ lat: 1, lng: 2 }, { lat: 1, lng: 2 }], crossings: [], stops: [], trees: [], street_lamps: [], restrictions: [],
    });
    expect(result.buildings).toHaveLength(1);
    expect(result.roads).toHaveLength(1);
    expect(result.signals).toHaveLength(1);
  });
});
