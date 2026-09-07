import { buildImmersiveNavigationState } from './immersiveNavigationRuntime';
import { NavigationEngine } from './navigationEngine';
import { Route3DHighlight } from '../types';

const route: Route3DHighlight = {
  segments: [{ coords: [{ lat: 21.1458, lng: 79.0882 }, { lat: 21.1465, lng: 79.0892 }, { lat: 21.1472, lng: 79.0901 }] }],
  maneuvers: [], distance_meters: 300, duration_seconds: 60,
} as Route3DHighlight;

describe('immersive navigation runtime', () => {
  it('produces a coherent state for a route', () => {
    const engine = new NavigationEngine();
    engine.setRoute(route);
    const state = buildImmersiveNavigationState({ snapshot: engine.snapshot(), route, maneuver: null, userLocation: route.segments[0].coords[0], scene: null, sceneAgeMs: null });
    expect(state).not.toBeNull();
    expect(state!.routeGeneration).toBe(1);
    expect(state!.routeContinuityAllowed).toBe(true);
  });

  it('changes generation across route replacement', () => {
    const engine = new NavigationEngine();
    engine.setRoute(route);
    const first = engine.snapshot().routeGeneration;
    engine.setRoute({ ...route, segments: [{ coords: [{ lat: 21.2, lng: 79.1 }, { lat: 21.21, lng: 79.11 }] }] });
    expect(engine.snapshot().routeGeneration).toBe(first + 1);
  });

  it('degrades instead of asserting lane authority without a lane match', () => {
    const engine = new NavigationEngine();
    engine.setRoute(route);
    const state = buildImmersiveNavigationState({ snapshot: engine.snapshot(), route, maneuver: null, userLocation: null, scene: null, sceneAgeMs: 10 * 60 * 1000 });
    expect(state!.fallback.level).not.toBe('lane');
    expect(state!.recovery.showRecoveryCue).toBe(true);
  });
});
