import { classifyJunctionBehavior, laneChangeWindowBufferMeters } from './junctionBehavior';
import { Maneuver } from '../types';

const maneuver = (type: string, modifier: string | null = null): Maneuver => ({
  type, modifier, location: { lat: 0, lng: 0 }, bearing_before: 0,
  instruction: '', is_complex: true,
});

describe('junction behavior', () => {
  it('blocks lane changes inside roundabouts', () => {
    const b = classifyJunctionBehavior(maneuver('roundabout'));
    expect(b.kind).toBe('roundabout-entry');
    expect(b.laneChangeAllowedInsideJunction).toBe(false);
  });

  it('treats ramps as merge/exit behaviors', () => {
    expect(classifyJunctionBehavior(maneuver('on-ramp')).kind).toBe('ramp-merge');
    expect(classifyJunctionBehavior(maneuver('off-ramp', 'right')).kind).toBe('ramp-exit');
  });

  it('gives complex junctions more runway', () => {
    expect(laneChangeWindowBufferMeters(classifyJunctionBehavior(maneuver('split')), 2)).toBeGreaterThan(60);
  });
});
