import { describe, expect, it } from 'vitest';
import { buildLaneChangeTrajectory } from './laneChangeTrajectory';

const road = {
  osm_id: 42, node_ids: [1, 2, 3, 4],
  geometry: [
    { lat: 20, lng: 0 }, { lat: 20, lng: 0.001 }, { lat: 20, lng: 0.002 }, { lat: 20, lng: 0.003 },
  ],
  highway: 'primary', name: 'Test', lanes: 3, oneway: true,
};

describe('lane change trajectory', () => {
  it('builds a geographic smooth trajectory between physical lane centerlines', () => {
    const result = buildLaneChangeTrajectory(road, 0, 1, 70);
    expect(result.reachable).toBe(true);
    expect(result.reason).toBe('physical');
    expect(result.points.length).toBeGreaterThan(8);
    expect(result.lateralShiftMeters).toBeGreaterThan(2);
    expect(result.points[0].lng).toBeLessThan(result.points.at(-1)!.lng);
  });

  it('rejects a lane change when the physical road has insufficient runway', () => {
    const shortRoad = { ...road, geometry: [{ lat: 20, lng: 0 }, { lat: 20, lng: 0.0002 }] };
    const result = buildLaneChangeTrajectory(shortRoad, 0, 2, 60, 28);
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('insufficient-runway');
  });

  it('does not manufacture movement when already in the target lane', () => {
    const result = buildLaneChangeTrajectory(road, 1, 1);
    expect(result.reason).toBe('same-lane');
    expect(result.reachable).toBe(true);
    expect(result.points).toHaveLength(0);
  });
});
