import { Maneuver, SceneRoad } from '../types';
import { resolveComplexJunctionLane } from './complexJunctionLaneResolver';

const road = (id: number, lanes: number, highway = 'primary'): SceneRoad => ({
  osm_id: id, node_ids: [id * 10 + 1, 10], geometry: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }],
  highway, name: null, lanes, oneway: true,
});

const maneuver = (type = 'turn'): Maneuver => ({
  type, modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 90, instruction: 'turn', is_complex: true,
});

describe('resolveComplexJunctionLane', () => {
  it('recognizes a lane-count merge', () => {
    const result = resolveComplexJunctionLane(road(1, 3), { ...road(2, 2), node_ids: [10, 21] }, maneuver('merge'), 2, 1);
    expect(result.kind).toBe('merge');
    expect(result.targetLaneIndex).not.toBeNull();
  });

  it('recognizes ramp/slip-lane topology', () => {
    const result = resolveComplexJunctionLane(road(1, 2), road(2, 1, 'primary_link'), maneuver(), 1, 0);
    expect(['ramp', 'slip-lane']).toContain(result.kind);
  });

  it('lowers confidence for closely spaced maneuvers', () => {
    const result = resolveComplexJunctionLane(road(1, 2), road(2, 2), maneuver(), 1, 1, [], [], 40);
    expect(result.kind).toBe('close-maneuvers');
    expect(result.confidence).toBeLessThan(0.9);
  });

  it('does not claim continuity when direction makes the junction illegal', () => {
    const from = { ...road(1, 2), oneway_reverse: true };
    const to = road(2, 2);
    const result = resolveComplexJunctionLane(from, to, maneuver(), 0, 0);
    expect(result.continuous).toBe(false);
  });
});
