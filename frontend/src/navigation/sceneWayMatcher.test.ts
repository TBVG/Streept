import { deriveSegmentSceneWaySequence, matchSceneWay } from './sceneWayMatcher';
import { SceneRoad } from '../types';

const road = (id: number, a: [number, number], b: [number, number], oneway = false, oneway_reverse = false): SceneRoad => ({
  osm_id: id, node_ids: [id * 10, id * 10 + 1], geometry: [{ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }],
  highway: 'residential', name: null, lanes: 2, oneway, oneway_reverse,
});

describe('sceneWayMatcher', () => {
  it('matches points to road segments, not only vertices', () => {
    const result = matchSceneWay({ lat: 0, lng: 0.0005 }, [road(1, [0, 0], [0, 0.001])]);
    expect(result?.wayId).toBe(1);
    expect(result?.progressMeters).toBeGreaterThan(40);
    expect(result?.progressMeters).toBeLessThan(70);
  });

  it('preserves ordered way transitions', () => {
    const roads = [road(1, [0, 0], [0, 0.001]), road(2, [0, 0.001], [0.001, 0.001])];
    const sequence = deriveSegmentSceneWaySequence([
      { lat: 0, lng: 0.0002 }, { lat: 0, lng: 0.0008 }, { lat: 0.0002, lng: 0.001 },
    ], roads);
    expect(sequence).toEqual([1, 2]);
  });

  it('reports reverse traversal for oneway=-1 geometry', () => {
    const result = matchSceneWay({ lat: 0, lng: 0.0005 }, [road(7, [0, 0], [0, 0.001], true, true)], null, 70, 270);
    expect(result?.travelDirection).toBe('reverse');
  });

  it('uses heading to select the correct direction on bidirectional geometry', () => {
    const result = matchSceneWay({ lat: 0, lng: 0.0005 }, [road(8, [0, 0], [0, 0.001])], null, 70, 270);
    expect(result?.travelDirection).toBe('reverse');
  });
});
