import { describe, expect, it } from 'vitest';
import { buildMultiManeuverChoreography } from './multiManeuverChoreography';
import { Maneuver, Route3DHighlight } from '../types';

const route = (maneuvers: Maneuver[]): Route3DHighlight => ({
  segments: [{ is_highlighted: true, color: '#fff', lane_index: null, coords: Array.from({ length: 241 }, (_, i) => ({ lat: i * 0.0001, lng: 0, alt: 0 })) }],
  maneuvers,
  duration_seconds: 100,
  distance_meters: 2700,
});

const maneuver = (lat: number, complex = false): Maneuver => ({
  type: complex ? 'roundabout' : 'turn',
  modifier: 'right',
  location: { lat, lng: 0 },
  bearing_before: 0,
  instruction: 'Turn right',
  is_complex: complex,
});

describe('multi-maneuver choreography', () => {
  it('keeps current, next and following priorities distinct', () => {
    const plan = buildMultiManeuverChoreography(route([maneuver(0.004), maneuver(0.009), maneuver(0.014, true)]), maneuver(0.004));
    expect(plan?.current?.role).toBe('current');
    expect(plan?.next?.role).toBe('next');
    expect(plan?.following?.role).toBe('following');
    expect(plan!.current!.strength).toBeGreaterThan(plan!.next!.strength);
    expect(plan!.next!.strength).toBeGreaterThan(plan!.following!.strength);
  });

  it('suppresses the following preview when decisions are too close', () => {
    const plan = buildMultiManeuverChoreography(route([maneuver(0.004), maneuver(0.0068), maneuver(0.0072)]), maneuver(0.004));
    expect(plan?.following).toBeNull();
  });

  it('compresses the next approach when another maneuver follows closely', () => {
    const spaced = buildMultiManeuverChoreography(route([maneuver(0.004), maneuver(0.012), maneuver(0.020)]), maneuver(0.004));
    const dense = buildMultiManeuverChoreography(route([maneuver(0.004), maneuver(0.010), maneuver(0.014)]), maneuver(0.004));
    const spacedLength = (spaced!.nextApproachEndIndex! - spaced!.nextApproachStartIndex!);
    const denseLength = (dense!.nextApproachEndIndex! - dense!.nextApproachStartIndex!);
    expect(denseLength).toBeLessThan(spacedLength);
  });
});
