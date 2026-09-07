import { describe, expect, it } from 'vitest';
import { mapLaneAcrossWays } from './laneContinuity';

const road = (lanes: number, reverse = false) => ({
  osm_id: lanes, node_ids: [1, 2], geometry: [{ lat: 20, lng: 0 }, { lat: 20, lng: 0.001 }],
  highway: 'primary', name: 'test', lanes, oneway: true, oneway_reverse: reverse,
});

describe('lane continuity', () => {
  it('preserves lane identity across equal-width way boundaries', () => {
    expect(mapLaneAcrossWays(2, road(3), road(3))?.laneIndex).toBe(2);
  });
  it('collapses a dropped lane toward the surviving edge', () => {
    const result = mapLaneAcrossWays(2, road(3), road(2));
    expect(result?.laneIndex).toBe(1);
    expect(result?.reason).toBe('merge');
  });
  it('keeps a source lane when a downstream split adds capacity', () => {
    const result = mapLaneAcrossWays(1, road(2), road(3));
    expect(result?.laneIndex).toBe(1);
    expect(result?.reason).toBe('split');
  });
});
