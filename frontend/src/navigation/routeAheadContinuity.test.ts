import { buildRouteAheadContinuityPlan } from './routeAheadContinuity';

const coords = Array.from({ length: 80 }, (_, i) => ({ lat: 0, lng: i * 0.0001 }));
const route = {
  segments: [{ coords, is_highlighted: true, color: '#fff', lane_index: null }],
  maneuvers: [
    { type: 'turn', modifier: 'right', location: coords[20], instruction: 'Turn right' },
    { type: 'turn', modifier: 'left', location: coords[60], instruction: 'Turn left' },
  ],
  duration_seconds: null,
  distance_meters: null,
} as any;

describe('route ahead continuity', () => {
  it('bridges the current maneuver to the next maneuver without entering the next decision point', () => {
    const plan = buildRouteAheadContinuityPlan(route, route.maneuvers[0], null);
    expect(plan).not.toBeNull();
    expect(plan!.startIndex).toBe(20);
    expect(plan!.endIndex).toBeLessThan(60);
    expect(plan!.nextManeuverIndex).toBe(60);
  });

  it('uses the driver position as the visual start when it is ahead of the current maneuver', () => {
    const plan = buildRouteAheadContinuityPlan(route, route.maneuvers[0], coords[30]);
    expect(plan!.startIndex).toBe(30);
  });

  it('does not create a bridge when there is no later maneuver', () => {
    const finalRoute = { ...route, maneuvers: [route.maneuvers[1]] } as any;
    expect(buildRouteAheadContinuityPlan(finalRoute, finalRoute.maneuvers[0], null)).toBeNull();
  });
});
