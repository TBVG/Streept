import { describe, expect, it } from 'vitest';
import { matchCurrentLane, projectLaneMatch } from './currentLaneMatcher';

const road = {
  osm_id: 10, node_ids: [1, 2, 3], geometry: [{ lat: 20, lng: 0 }, { lat: 20, lng: 0.001 }, { lat: 20.0004, lng: 0.0014 }],
  highway: 'primary', name: 'Test', lanes: 3, oneway: true,
  turn_lanes: ['left', 'through', 'right'], change_lanes: ['yes', 'yes', 'yes'], destination_lanes: null,
};

describe('current lane matcher', () => {
  it('projects onto the middle of a long segment instead of a nearest vertex', () => {
    const result = projectLaneMatch({ lat: 20.00003, lng: 0.0005 }, road);
    expect(result?.segmentIndex).toBe(0);
    expect(result?.progress).toBeCloseTo(0.5, 1);
    expect(result?.distanceMeters).toBeLessThan(5);
  });

  it('maps a GPS fix to the physical lane in travel direction', () => {
    const result = matchCurrentLane({ lat: 20.000034, lng: 0.0005 }, [road], 90);
    expect(result?.laneIndex).toBe(0);
    expect(result?.confidence).toBeGreaterThan(0.5);
  });

  it('flips lateral lane numbering on reverse one-way roads', () => {
    const reverseRoad = { ...road, oneway: false, oneway_reverse: true };
    const result = matchCurrentLane({ lat: 19.999966, lng: 0.0005 }, [reverseRoad], 270);
    expect(result?.laneIndex).toBe(0);
  });
});
