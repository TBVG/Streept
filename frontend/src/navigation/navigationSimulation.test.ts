import { NavigationEngine } from './navigationEngine';
import { simulateNavigation, routeForSimulation } from './navigationSimulation';
import { Location } from '../types';

const ROUTE: Location[] = [
  { lat: 21.1458, lng: 79.0882 },
  { lat: 21.1467, lng: 79.0892 },
  { lat: 21.1477, lng: 79.0908 },
  { lat: 21.1490, lng: 79.0920 },
];

function activeEngine(): NavigationEngine {
  const engine = new NavigationEngine({ now: () => 0 });
  engine.setRoute(routeForSimulation(ROUTE));
  engine.dispatch({ type: 'PLAN', hasRoute: true });
  engine.dispatch({ type: 'START', hasRoute: true });
  return engine;
}

test('simulated drive reaches the route end with monotonic progress', () => {
  const result = simulateNavigation(activeEngine(), {
    route: ROUTE,
    speedMps: 12,
    stepMs: 400,
    gpsAccuracyMeters: 4,
    gpsNoiseMeters: 1.5,
  });
  expect(result.acceptedFixes).toBeGreaterThan(5);
  expect(result.monotonicViolations).toBe(0);
  expect(result.completed).toBe(true);
  expect(result.finalProgressMeters).toBeGreaterThan(result.routeLengthMeters - 35);
});

test('GPS dropout uses continuity without restarting the session', () => {
  const result = simulateNavigation(activeEngine(), {
    route: ROUTE,
    speedMps: 10,
    stepMs: 500,
    gpsAccuracyMeters: 5,
    dropoutWindowsMs: [{ start: 2500, end: 9500 }],
  });
  expect(result.continuitySamples).toBeGreaterThan(0);
  expect(result.completed).toBe(true);
  expect(result.finalHealth.route).toBe('on-route');
});

test('moderate deterministic GPS noise does not create repeated backwards progress', () => {
  const result = simulateNavigation(activeEngine(), {
    route: ROUTE,
    speedMps: 8,
    stepMs: 300,
    gpsAccuracyMeters: 8,
    gpsNoiseMeters: 5,
    lateralNoiseMeters: 2,
  });
  expect(result.monotonicViolations).toBe(0);
  expect(result.acceptedFixes).toBeGreaterThan(5);
});
