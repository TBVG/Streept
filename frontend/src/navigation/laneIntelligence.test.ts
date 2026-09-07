import { buildRouteLanePlan } from './laneIntelligence';
import { describe, expect, it } from 'vitest';
import { getLaneRecommendations, laneGuidanceLabel, estimateDriverLane, laneChangeGuidance, analyzeLanePath } from './laneIntelligence';

describe('laneIntelligence', () => {
  it('prefers the lane that matches the maneuver direction', () => {
    const result = getLaneRecommendations({
      type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 90,
      instruction: 'Turn right', is_complex: true,
      lanes: [
        { indications: ['left'], valid: true },
        { indications: ['straight'], valid: true },
        { indications: ['right'], valid: true },
      ],
    });
    expect(result[2].preferred).toBe(true);
    expect(result[0].preferred).toBe(false);
  });

  it('supports multiple valid target lanes', () => {
    const result = getLaneRecommendations({
      type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 90,
      instruction: 'Turn right', is_complex: true,
      lanes: [
        { indications: ['straight'], valid: true },
        { indications: ['through', 'right'], valid: true },
        { indications: ['right'], valid: true },
      ],
    });
    expect(result.filter((lane) => lane.preferred).length).toBe(2);
    expect(laneGuidanceLabel({
      type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 90,
      instruction: 'Turn right', is_complex: true,
      lanes: [
        { indications: ['straight'], valid: true },
        { indications: ['through', 'right'], valid: true },
        { indications: ['right'], valid: true },
      ],
    })).toContain('Use lanes');
  });

  it('returns no recommendation when lane data is absent', () => {
    expect(laneGuidanceLabel({ type: 'turn', modifier: 'left', location: { lat: 0, lng: 0 }, bearing_before: 0, instruction: 'Turn left', is_complex: true })).toBeNull();
  });
});


describe('driver-aware lane positioning', () => {
  const maneuver = {
    type: 'turn' as const, modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 90,
    instruction: 'Turn right', is_complex: true,
    lanes: [
      { indications: ['left'], valid: false },
      { indications: ['through'], valid: true },
      { indications: ['right'], valid: true },
    ],
  };

  it('estimates a stable lane index from signed lateral position', () => {
    const estimate = estimateDriverLane(-2.8, 3);
    expect(estimate.laneIndex).toBe(2);
    expect(estimate.confidence).toBeGreaterThan(0.7);
  });

  it('tells a driver to move toward the recommended lane', () => {
    expect(laneChangeGuidance(maneuver, 1)).toBe('Move right 1 lane');
    expect(laneChangeGuidance(maneuver, 2)).toBe('Stay in this lane');
  });
});

describe('safe lane changes', () => {
  it('downgrades an immediate change when the current lane blocks it', () => {
    const maneuver = {
      type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 0,
      instruction: 'Turn right', is_complex: true,
      lanes: [
        { indications: ['through'], valid: true, change: 'only:left' },
        { indications: ['right'], valid: true },
      ],
    } as any;
    expect(laneChangeGuidance(maneuver, 0)).toBe('Prepare to change lanes');
  });
});


describe('lane graph intelligence', () => {
  it('honors only:right restrictions', () => {
    const m = { type: 'turn', modifier: 'left', location: { lat: 0, lng: 0 }, bearing_before: 0, instruction: 'Turn left', is_complex: true, lanes: [
      { indications: ['left'], valid: true }, { indications: ['through'], valid: true, change: 'only:right' },
    ] } as any;
    expect(analyzeLanePath(m, 1).reachable).toBe(false);
  });
  it('finds a legal multi-lane path', () => {
    const m = { type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 0, instruction: 'Turn right', is_complex: true, lanes: [
      { indications: ['through'], valid: true }, { indications: ['through'], valid: true }, { indications: ['right'], valid: true },
    ] } as any;
    const r = analyzeLanePath(m, 0);
    expect(r.requiredLaneChanges).toBe(2); expect(r.reachable).toBe(true);
  });
});


describe('buildRouteLanePlan', () => {
  it('carries a compatible target lane into the next maneuver', () => {
    const maneuvers = [
      { type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 0, instruction: 'right', is_complex: true, lanes: [
        { indications: ['through'], valid: false, change: 'yes' },
        { indications: ['right'], valid: true, change: 'yes' },
      ] },
      { type: 'turn', modifier: 'left', location: { lat: 0, lng: 0.01 }, bearing_before: 0, instruction: 'left', is_complex: true, lanes: [
        { indications: ['left'], valid: true, change: 'yes' },
        { indications: ['through'], valid: false, change: 'yes' },
      ] },
    ] as any;
    const plan = buildRouteLanePlan(maneuvers, 1, 0.95);
    expect(plan.steps[0].targetLaneIndex).toBe(1);
    expect(plan.steps[1].targetLaneIndex).toBe(0);
    expect(plan.totalLaneChanges).toBe(1);
  });
});
