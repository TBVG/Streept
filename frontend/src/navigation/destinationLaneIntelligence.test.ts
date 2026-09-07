import { describe, expect, it } from 'vitest';
import { chooseDestinationLane, buildDestinationLaneTiming } from './destinationLaneIntelligence';
import { Maneuver, SceneRoad } from '../types';

const maneuver: Maneuver = { type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 0, instruction: 'Turn right', is_complex: true };
const road: SceneRoad = { osm_id: 10, node_ids: [1, 2], geometry: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }], highway: 'primary', name: 'Main', lanes: 3, oneway: true, destination_lanes: ['Downtown|Airport', 'Downtown', 'Suburbs'], turn_lanes: ['left', 'through;right', 'right'], change_lanes: null };

describe('destination lane intelligence', () => {
  it('selects a lane whose destination matches the trip label', () => {
    expect(chooseDestinationLane(road, maneuver, 'Downtown')).toBe(1);
  });

  it('computes an actionable lane-change window', () => {
    const timing = buildDestinationLaneTiming(0, 2, 110);
    expect(timing.laneChanges).toBe(2);
    expect(timing.direction).toBe('right');
    expect(timing.urgency).toBe('prepare');
    expect(timing.latestChangeMeters).toBeLessThan(110);
  });
});
