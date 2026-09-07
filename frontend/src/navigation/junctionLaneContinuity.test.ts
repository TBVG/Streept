import { describe, expect, it } from 'vitest';
import { buildJunctionLaneContinuity, mapLaneThroughJunction } from './junctionLaneContinuity';
import { SceneRoad } from '../types';

const road = (id: number, nodes: number[], lanes: number, turn_lanes: string[] | null = null): SceneRoad => ({
  osm_id: id,
  node_ids: nodes,
  geometry: nodes.map((_, i) => ({ lat: 20 + i * 0.001, lng: 75 + id * 0.00001 })),
  highway: 'primary', name: null, lanes, oneway: true, oneway_reverse: false,
  turn_lanes, change_lanes: null, destination_lanes: null,
});

const left = { type: 'turn', modifier: 'left', location: { lat: 20.001, lng: 75 }, bearing_before: 0, instruction: 'turn left', is_complex: false };

describe('junction lane continuity', () => {
  it('keeps a through lane identity across an equal-width junction', () => {
    const result = mapLaneThroughJunction(road(1, [10, 11], 3), road(2, [11, 12], 3), 1);
    expect(result?.legal).toBe(true);
    expect(result?.toLane).toBe(1);
    expect(result?.reason).toBe('direct');
    expect(result?.geometry?.points.length).toBeGreaterThan(4);
    expect(result?.geometry?.lengthMeters).toBeGreaterThan(0);
  });

  it('uses turn:lanes to avoid a generic proportional lane choice', () => {
    const result = mapLaneThroughJunction(
      road(1, [10, 11], 3, ['left', 'through', 'right']),
      road(2, [11, 12], 2),
      0,
      left,
    );
    expect(result?.legal).toBe(true);
    expect(result?.reason).toBe('turn-lane');
  });

  it('blocks a prohibited transition before lane mapping', () => {
    const result = mapLaneThroughJunction(
      road(1, [10, 11], 2),
      road(2, [11, 12], 2),
      0,
      null,
      [{ osm_id: 99, restriction: 'no_right_turn', from_way_ids: [1], to_way_ids: [2], via_node_ids: [11] }],
    );
    expect(result?.legal).toBe(false);
    expect(result?.reason).toBe('restriction');
  });

  it('builds a curved physical connector for a turn', () => {
    const result = mapLaneThroughJunction(
      road(1, [10, 11], 2),
      road(2, [11, 12], 2),
      0,
      left,
    );
    expect(result?.geometry?.kind).toBe('turn');
    expect(result?.geometry?.points.length).toBeGreaterThan(8);
  });

  it('builds continuity for every lane across consecutive junctions', () => {
    const roads = [road(1, [10, 11], 2), road(2, [11, 12], 2), road(3, [12, 13], 3)];
    const mappings = buildJunctionLaneContinuity(roads, [1, 2, 3]);
    expect(mappings.filter((x) => x.fromWayId === 1 && x.toWayId === 2)).toHaveLength(2);
    expect(mappings.filter((x) => x.fromWayId === 2 && x.toWayId === 3)).toHaveLength(2);
  });
});

