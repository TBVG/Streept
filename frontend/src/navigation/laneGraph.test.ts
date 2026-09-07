import { buildPhysicalLaneGraph, laneTransition } from './laneGraph';
import { SceneRoad } from '../types';

const road = (id: number, nodes: number[], lanes = 2, oneway = true): SceneRoad => ({
  osm_id: id, node_ids: nodes, geometry: nodes.map((_, i) => ({ lat: 20 + i * 0.001, lng: 75 + id * 0.00001, alt: 0 })),
  highway: 'primary', name: null, lanes, oneway, oneway_reverse: false,
});

describe('physical lane graph', () => {
  it('connects directional ways through a shared junction', () => {
    const graph = buildPhysicalLaneGraph([road(1, [10, 11]), road(2, [11, 12])], [], [1, 2]);
    const edge = laneTransition(graph, 1, 2, 0);
    expect(edge?.legal).toBe(true);
    expect(edge?.junctionNodeId).toBe(11);
  });

  it('rejects a transition against one-way direction', () => {
    const graph = buildPhysicalLaneGraph([road(1, [10, 11]), road(2, [12, 11])], [], [1, 2]);
    expect(laneTransition(graph, 1, 2, 0)?.legal).toBe(false);
  });

  it('models a 2-to-3 lane split without inventing direct identity for every lane', () => {
    const graph = buildPhysicalLaneGraph([road(1, [10, 11], 2), road(2, [11, 12], 3)], [], [1, 2]);
    const direct = laneTransition(graph, 1, 2, 0);
    expect(direct?.legal).toBe(true);
    expect(direct?.continuity).toBe('direct');
    expect(graph.edges.some((edge) => edge.fromLane === 0 && edge.continuity === 'split')).toBe(true);
  });

  it('models a 3-to-2 lane merge and preserves a lane-drop mapping', () => {
    const graph = buildPhysicalLaneGraph([road(1, [10, 11], 3), road(2, [11, 12], 2)], [], [1, 2]);
    const merged = graph.edges.filter((edge) => edge.fromWayId === 1 && edge.toWayId === 2 && edge.fromLane === 2);
    expect(merged.length).toBeGreaterThan(0);
    expect(merged.some((edge) => edge.reason === 'merge')).toBe(true);
  });

  it('blocks an OSM no-turn restriction', () => {
    const graph = buildPhysicalLaneGraph(
      [road(1, [10, 11]), road(2, [11, 12])],
      [{ osm_id: 99, restriction: 'no_right_turn', from_way_ids: [1], to_way_ids: [2], via_node_ids: [11] }],
      [1, 2],
    );
    expect(laneTransition(graph, 1, 2, 0)?.legal).toBe(false);
  });
});
