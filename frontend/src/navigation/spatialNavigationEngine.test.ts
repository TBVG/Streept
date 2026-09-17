import { describe, expect, it } from 'vitest';
import { buildSpatialNavigationPlan } from './spatialNavigationEngine';
import { Route3DHighlight } from '../types';

const route: Route3DHighlight = {
  provider: 'osrm', duration_seconds: 120, distance_meters: 500,
  segments: [{ lane_index: null, is_highlighted: true, color: '#20F28A', coords: [
    { lat: 20, lng: 73, alt: 0 }, { lat: 20.0005, lng: 73, alt: 0 }, { lat: 20.001, lng: 73, alt: 0 },
  ] }],
  maneuvers: [{ type: 'turn', modifier: 'right', location: { lat: 20.0005, lng: 73 }, bearing_before: 0, instruction: 'Turn right', is_complex: true, lanes: [] }],
};

describe('spatialNavigationEngine', () => {
  it('selects the upcoming maneuver and enters immersive mode near a complex turn', () => {
    const plan = buildSpatialNavigationPlan({ route, userLocation: { lat: 20.00045, lng: 73 }, speedMps: 10 });
    expect(plan.maneuver?.instruction).toBe('Turn right');
    expect(plan.distanceToManeuverMeters).not.toBeNull();
    expect(plan.presentation).toBe('immersive');
  });

  it('stays on the map when there is no route', () => {
    const plan = buildSpatialNavigationPlan({ route: null, userLocation: null });
    expect(plan.presentation).toBe('map');
    expect(plan.maneuver).toBeNull();
  });
});
