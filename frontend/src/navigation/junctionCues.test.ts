import { describe, expect, it } from 'vitest';
import { buildJunctionCuePlan } from './junctionCues';
import { classifyJunctionBehavior } from './junctionBehavior';
import { Maneuver, Route3DHighlight } from '../types';

const route: Route3DHighlight = {
  segments: [{ is_highlighted: true, color: '#fff', lane_index: null, coords: Array.from({ length: 31 }, (_, i) => ({ lat: i * 0.0005, lng: 0, alt: 0 })) }],
  maneuvers: [], duration_seconds: 100, distance_meters: 1600,
};
const maneuver: Maneuver = { type: 'turn', modifier: 'right', location: { lat: 0.0075, lng: 0 }, bearing_before: 0, instruction: 'Turn right', is_complex: false };

it('keeps simple turns visually quieter', () => {
  const plan = buildJunctionCuePlan(route, maneuver, classifyJunctionBehavior(maneuver));
  expect(plan?.complexity).toBe('simple');
  expect(plan?.showBranchAlternatives).toBe(false);
  expect(plan?.zones).toHaveLength(3);
});

it('expands complex junction comprehension earlier', () => {
  const complex: Maneuver = { ...maneuver, type: 'roundabout', is_complex: true };
  const plan = buildJunctionCuePlan(route, complex, classifyJunctionBehavior(complex));
  expect(plan?.complexity).toBe('complex');
  expect(plan?.showBranchAlternatives).toBe(true);
  expect(plan?.showDecisionLabel).toBe(true);
  expect(plan!.zones[0].endIndex - plan!.zones[0].startIndex).toBeGreaterThan(0);
});
