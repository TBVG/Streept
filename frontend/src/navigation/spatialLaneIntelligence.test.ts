import { describe, expect, it } from 'vitest';
import { deriveSpatialLaneIntelligence } from './spatialLaneIntelligence';

const road = {
  osm_id: 1, geometry: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }], highway: 'primary', name: 'Main',
  lanes: 3, oneway: true, turn_lanes: ['left', 'through|right', 'right'], change_lanes: null, destination_lanes: null,
};
const maneuver = { type: 'turn', modifier: 'right', location: { lat: 0, lng: 0.01 }, bearing_before: 0, instruction: 'Turn right', is_complex: false };

describe('spatial lane intelligence', () => {
  it('recognizes an already aligned lane', () => {
    const result = deriveSpatialLaneIntelligence(road, maneuver, 2);
    expect(result.laneAlignment).toBe('aligned');
    expect(result.laneChangeDirection).toBe('stay');
    expect(result.requiredLaneChanges).toBe(0);
  });

  it('identifies the direction and distance to a route-compatible lane', () => {
    const result = deriveSpatialLaneIntelligence(road, maneuver, 0);
    expect(result.laneAlignment).toBe('misaligned');
    expect(result.laneChangeDirection).toBe('right');
    expect(result.requiredLaneChanges).toBe(1);
  });

  it('does not invent a recommendation when lane semantics are unavailable', () => {
    const result = deriveSpatialLaneIntelligence({ ...road, turn_lanes: null }, maneuver, 1);
    expect(result.laneAlignment).toBe('unknown');
    expect(result.recommendedLaneIndices).toEqual([]);
  });
});
