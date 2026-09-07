import { describe, expect, it } from 'vitest';
import { NavigationEngine } from './navigationEngine';
import { buildSceneGuidancePlan } from './sceneGuidance';
import { deriveNavigationVisualState } from './navigationVisualState';
import { Maneuver, Route3DHighlight } from '../types';

const route: Route3DHighlight = {
  segments: [{
    is_highlighted: true,
    color: '#fff',
    lane_index: null,
    coords: [
      { lat: 0, lng: 0, alt: 0 },
      { lat: 0, lng: 0.001, alt: 0 },
      { lat: 0, lng: 0.002, alt: 0 },
      { lat: 0, lng: 0.003, alt: 0 },
      { lat: 0, lng: 0.004, alt: 0 },
      { lat: 0.001, lng: 0.004, alt: 0 },
      { lat: 0.002, lng: 0.004, alt: 0 },
    ],
  }],
  maneuvers: [],
  duration_seconds: 120,
  distance_meters: 670,
};

const maneuver: Maneuver = {
  type: 'turn',
  modifier: 'right',
  location: { lat: 0.0005, lng: 0.004 },
  bearing_before: 0,
  instruction: 'Turn right',
  is_complex: false,
  lanes: [
    { indications: ['through'], valid: true, change: 'not:right' },
    { indications: ['right'], valid: true, recommended: true },
  ],
};

describe('navigation integration contract', () => {
  it('keeps lifecycle, GPS matching, scene guidance and visual state aligned', () => {
    const engine = new NavigationEngine({ now: () => 5000 });
    engine.setRoute(route);

    expect(engine.snapshot().state).toEqual({ phase: 'idle', sessionActive: false });
    engine.dispatch({ type: 'PLAN', hasRoute: true });
    engine.dispatch({ type: 'START' });
    expect(engine.snapshot().state).toEqual({ phase: 'navigating', sessionActive: true });

    const fix = engine.acceptGpsFix({
      location: { lat: 0, lng: 0.002 },
      timestampMs: 1000,
      accuracyMeters: 5,
      speedMps: 12,
      headingDegrees: 90,
    });
    expect(fix.accepted).toBe(true);
    expect(fix.matched?.onRoute).toBe(true);

    const scene = buildSceneGuidancePlan(route, maneuver, 0, 0.9);
    expect(scene?.laneCount).toBe(2);
    expect(scene?.targetLaneIndex).toBe(1);
    expect(scene?.connectorTopology.connectors.length).toBeGreaterThan(0);

    const visual = deriveNavigationVisualState({
      phase: engine.snapshot().state.phase,
      sessionActive: engine.snapshot().state.sessionActive,
      distanceToManeuverMeters: 80,
      laneGuidance: 'Move right',
      laneConfidence: scene?.laneConfidence ?? 0,
      gpsConfidence: fix.matched?.confidence ?? 0,
      immersiveAvailable: true,
    });
    expect(visual.mode).toBe('active');
    expect(visual.showRoute).toBe(true);
    expect(visual.showImmersivePreview).toBe(true);
    expect(visual.guidanceUrgency).toBe('prepare');
    expect(visual.laneGuidance).toBe('Move right');
  });

  it('preserves navigation session across reroute and completes cleanly', () => {
    const engine = new NavigationEngine();
    engine.setRoute(route);
    engine.dispatch({ type: 'PLAN', hasRoute: true });
    engine.dispatch({ type: 'START' });
    engine.dispatch({ type: 'REROUTE' });
    expect(engine.snapshot().state).toEqual({ phase: 'rerouting', sessionActive: true });

    engine.dispatch({ type: 'REROUTE_SUCCEEDED' });
    expect(engine.snapshot().state).toEqual({ phase: 'navigating', sessionActive: true });

    engine.dispatch({ type: 'ARRIVE' });
    expect(engine.snapshot().state).toEqual({ phase: 'arrived', sessionActive: false });

    const visual = deriveNavigationVisualState({
      phase: 'arrived',
      sessionActive: false,
      distanceToManeuverMeters: 0,
      laneGuidance: 'Move right',
      laneConfidence: 1,
      gpsConfidence: 1,
      immersiveAvailable: true,
    });
    expect(visual.showArrival).toBe(true);
    expect(visual.showImmersivePreview).toBe(false);
    expect(visual.laneGuidance).toBeNull();
  });
});
