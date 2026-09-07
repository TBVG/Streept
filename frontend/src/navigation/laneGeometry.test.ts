import { describe, expect, it } from 'vitest';
import { buildLaneCenterline } from './laneGeometry';
import { SceneRoad } from '../types';

const road: SceneRoad = {
  osm_id: 10,
  node_ids: [100, 101, 102],
  geometry: [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
    { lat: 0.001, lng: 0.002 },
  ],
  highway: 'primary', name: null, lanes: 3, oneway: true,
};

describe('lane geometry', () => {
  it('follows curved road geometry instead of using one fixed junction offset', () => {
    const lane = buildLaneCenterline(road, 0, 3)!;
    expect(lane.points).toHaveLength(3);
    expect(lane.points[0].lat).not.toBe(road.geometry[0].lat);
    expect(lane.points[1].lat).not.toBe(road.geometry[1].lat);
    expect(lane.points[1].lng).toBeCloseTo(road.geometry[1].lng, 5);
    expect(lane.points[2].lng).not.toBe(road.geometry[2].lng);
  });
});
