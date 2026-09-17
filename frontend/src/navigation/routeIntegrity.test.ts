import { describe, expect, it } from 'vitest';
import { isTrustedRoute, routePolyline } from './routeIntegrity';
import { Route3DHighlight } from '../types';

const realRoute = (): Route3DHighlight => ({
  provider: 'osrm',
  segments: [{
    coords: [{ lat: 21.1458, lng: 79.0882, alt: 0 }, { lat: 21.1462, lng: 79.0888, alt: 0 }],
    is_highlighted: true,
    color: '#2D7FF9',
    lane_index: null,
  }],
  maneuvers: [],
  duration_seconds: 120,
  distance_meters: 900,
});

describe('route integrity', () => {
  it('accepts only provider-backed route geometry', () => {
    expect(isTrustedRoute(realRoute())).toBe(true);
  });

  it('rejects legacy/synthetic geometry even when coordinates are valid', () => {
    const legacy = { ...realRoute(), provider: undefined };
    expect(isTrustedRoute(legacy)).toBe(false);
  });

  it('rejects malformed coordinates', () => {
    const malformed = realRoute();
    malformed.segments[0].coords[1].lat = Number.NaN;
    expect(isTrustedRoute(malformed)).toBe(false);
  });

  it('returns a clean navigation polyline', () => {
    expect(routePolyline(realRoute())).toEqual([
      { lat: 21.1458, lng: 79.0882 },
      { lat: 21.1462, lng: 79.0888 },
    ]);
  });
});
