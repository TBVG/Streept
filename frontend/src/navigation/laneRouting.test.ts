import { describe, expect, it } from 'vitest';
import { buildLaneRoutePlan } from './laneRouting';

const route = (distance = 0.07) => ({
  segments: [{ coords: [
    { lat: 0, lng: 0, alt: 0 },
    { lat: 0, lng: distance / 111.32, alt: 0 },
    { lat: 0, lng: (distance * 2) / 111.32, alt: 0 },
  ], is_highlighted: true, color: '#fff', lane_index: null }],
  maneuvers: [{
    type: 'turn', modifier: 'right', location: { lat: 0, lng: distance / 111.32 },
    bearing_before: 90, instruction: 'Turn right', is_complex: true,
    lanes: [
      { indications: ['through'], valid: true },
      { indications: ['right'], valid: true },
    ],
  }],
  duration_seconds: 60, distance_meters: 200,
} as any);

describe('laneRouting', () => {
  it('creates an actionable window before a lane-dependent maneuver', () => {
    const plan = buildLaneRoutePlan(route(), 0, 0.95);
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0].targetLaneIndex).toBe(1);
    expect(plan.windows[0].laneChanges).toBe(1);
    expect(plan.windows[0].latestChangeMeters).toBeGreaterThan(0);
    expect(plan.nextAction?.urgency).toBe('change-now');
  });

  it('does not invent lane actions when lane metadata is absent', () => {
    const r = route() as any;
    r.maneuvers[0].lanes = undefined;
    const plan = buildLaneRoutePlan(r, null, 1);
    expect(plan.windows[0].laneChanges).toBe(0);
    expect(plan.nextAction).toBeNull();
  });
});
