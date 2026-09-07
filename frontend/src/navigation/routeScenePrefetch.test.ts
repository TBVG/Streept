import { buildRouteScenePrefetchPlan } from './routeScenePrefetch';
import { Route3DHighlight } from '../types';

const route = (): Route3DHighlight => ({
  segments: [{
    coords: Array.from({ length: 12 }, (_, i) => ({ lat: 0, lng: i * 0.001, alt: 0 })),
    is_highlighted: true, color: '#fff', lane_index: null,
  }],
  maneuvers: [], duration_seconds: 100, distance_meters: 1200,
});

test('plans bounded route-ahead bubble centers', () => {
  const plan = buildRouteScenePrefetchPlan(route(), { lat: 0, lng: 0 }, [], { horizonMeters: 900, spacingMeters: 220, maxLocations: 4 });
  expect(plan.locations.length).toBeGreaterThan(0);
  expect(plan.locations.length).toBeLessThanOrEqual(4);
  expect(plan.locations[0].lng).toBeGreaterThan(0);
});

test('does not prefetch behind the driver', () => {
  const plan = buildRouteScenePrefetchPlan(route(), { lat: 0, lng: 0.005 }, [], { horizonMeters: 500, spacingMeters: 150, maxLocations: 5 });
  expect(plan.locations.every((p) => p.lng > 0.005)).toBe(true);
});

test('deduplicates nearby targets into stable cache keys', () => {
  const plan = buildRouteScenePrefetchPlan(route(), { lat: 0, lng: 0 }, [], { horizonMeters: 400, spacingMeters: 80, maxLocations: 8 });
  expect(new Set(plan.keys).size).toBe(plan.keys.length);
});
