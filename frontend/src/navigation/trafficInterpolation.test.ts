import { describe, expect, it } from 'vitest';
import { TrafficInterpolator } from './trafficInterpolation';

const vehicle = (overrides: Record<string, unknown> = {}) => ({
  id: 'v1', location: { lat: 0, lng: 0 }, way_id: null, segment_id: null, lane_index: 0,
  speed_mps: 10, heading_degrees: 90, observed_at: new Date(1000).toISOString(), confidence: 1, source: 'test', ...overrides,
} as any);

describe('TrafficInterpolator', () => {
  it('interpolates between telemetry packets', () => {
    const i = new TrafficInterpolator();
    i.update(vehicle({ location: { lat: 0, lng: 0 }, observed_at: new Date(1000).toISOString() }), { lat: 0, lng: 0 }, 90);
    i.update(vehicle({ location: { lat: 0, lng: 0.001 }, observed_at: new Date(2000).toISOString() }), { lat: 0, lng: 0.001 }, 90);
    const sample = i.sample('v1', 1500)!;
    expect(sample.location.lng).toBeCloseTo(0.0005, 6);
  });

  it('extrapolates only briefly after a delayed packet', () => {
    const i = new TrafficInterpolator();
    i.update(vehicle({ location: { lat: 0, lng: 0 }, observed_at: new Date(1000).toISOString() }), { lat: 0, lng: 0 }, 90);
    const sample = i.sample('v1', 2000)!;
    expect(sample.location.lng).toBeGreaterThan(0);
    expect(i.sample('v1', 5000)!.location.lng).toBeCloseTo(0, 7);
  });

  it('ignores stale packets and implausible teleports', () => {
    const i = new TrafficInterpolator();
    i.update(vehicle({ observed_at: new Date(2000).toISOString() }), { lat: 0, lng: 0 }, 0);
    i.update(vehicle({ location: { lat: 0, lng: 1 }, observed_at: new Date(3000).toISOString() }), { lat: 0, lng: 1 }, 0);
    expect(i.sample('v1', 3000)!.location.lng).toBe(0);
    i.update(vehicle({ location: { lat: 0, lng: 0.0001 }, observed_at: new Date(1500).toISOString() }), { lat: 0, lng: 0.0001 }, 0);
    expect(i.sample('v1', 3000)!.location.lng).toBe(0);
  });

  it('handles heading wrap-around', () => {
    const i = new TrafficInterpolator();
    i.update(vehicle({ heading_degrees: 359, observed_at: new Date(1000).toISOString() }), { lat: 0, lng: 0 }, 359);
    i.update(vehicle({ heading_degrees: 1, observed_at: new Date(2000).toISOString() }), { lat: 0, lng: 0.0001 }, 1);
    expect(i.sample('v1', 1500)!.headingDegrees).toBeCloseTo(0, 5);
  });
});
