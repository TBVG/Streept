import { describe, expect, it } from 'vitest';
import { buildPredictiveJunctionApproach } from './predictiveJunctionApproach';

const route = {
  segments: [{ coords: [0,1,2,3,4,5,6,7,8,9].map((lat) => ({ lat, lng: 0, alt: 0 })) }],
  maneuvers: [],
} as any;
const maneuver = { location: { lat: 8, lng: 0 }, is_complex: false } as any;
const complex = { location: { lat: 8, lng: 0 }, is_complex: true } as any;

describe('predictive junction approach', () => {
  it('extends the preparation window as speed rises', () => {
    const slow = buildPredictiveJunctionApproach(route, maneuver, { lat: 0, lng: 0 }, 2)!;
    const fast = buildPredictiveJunctionApproach(route, maneuver, { lat: 0, lng: 0 }, 20)!;
    expect(fast.preparationDistanceMeters).toBeGreaterThan(slow.preparationDistanceMeters);
  });
  it('keeps stopped traffic spatially bounded instead of making cues explode', () => {
    const stopped = buildPredictiveJunctionApproach(route, complex, { lat: 0, lng: 0 }, 0)!;
    expect(stopped.trafficMode).toBe('stopped');
    expect(stopped.preparationDistanceMeters).toBeLessThanOrEqual(150);
  });
  it('makes a nearby maneuver more prominent than a distant one at the same speed', () => {
    const near = buildPredictiveJunctionApproach(route, maneuver, { lat: 6.5, lng: 0 }, 10)!;
    const far = buildPredictiveJunctionApproach(route, maneuver, { lat: 0, lng: 0 }, 10)!;
    expect(near.prominence).toBeGreaterThan(far.prominence);
  });
});
