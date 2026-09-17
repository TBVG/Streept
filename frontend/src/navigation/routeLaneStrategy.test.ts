import { describe, expect, it } from 'vitest';
import { buildRouteLaneStrategy } from './routeLaneStrategy';

const maneuver = (lanes: any[], modifier: string) => ({
  type: 'turn', modifier, location: { lat: 0, lng: 0 }, bearing_before: 0,
  instruction: modifier, lanes,
} as any);

const through = () => [
  { indications: ['through'], valid: true },
  { indications: ['through'], valid: true },
];

const right = () => [
  { indications: ['through'], valid: true },
  { indications: ['right'], valid: true },
];

describe('routeLaneStrategy', () => {
  it('keeps a useful lane across upcoming maneuvers instead of returning to neutral', () => {
    const plan = buildRouteLaneStrategy([
      maneuver(right(), 'right'),
      maneuver(through(), 'straight'),
      maneuver(right(), 'right'),
    ], 0, 0.95, 3);
    expect(plan.steps[0].plannedLaneIndex).toBe(1);
    expect(plan.steps[1].plannedLaneIndex).toBe(1);
    expect(plan.steps[2].plannedLaneIndex).toBe(1);
    expect(plan.totalLaneChanges).toBe(1);
  });

  it('does not invent a lane when a maneuver has no lane metadata', () => {
    const plan = buildRouteLaneStrategy([
      maneuver([], 'right'),
      maneuver(right(), 'right'),
    ], 0, 1, 3);
    expect(plan.steps[0].plannedLaneIndex).toBeNull();
    expect(plan.steps[1].plannedLaneIndex).toBe(1);
  });

  it('penalizes unnecessary lane oscillation', () => {
    const plan = buildRouteLaneStrategy([
      maneuver(right(), 'right'),
      maneuver([{ indications: ['left'], valid: true }, { indications: ['through'], valid: true }], 'left'),
      maneuver(right(), 'right'),
    ], 0, 1, 3);
    expect(plan.totalLaneChanges).toBeGreaterThanOrEqual(2);
    expect(plan.steps.every((step) => step.stabilityScore >= 0)).toBe(true);
  });

  it('keeps a stable planned lane across upcoming maneuvers when the same lane remains valid', () => {
    const plan = buildRouteLaneStrategy([
      maneuver([{ laneIndex: 1, recommended: true }]),
      maneuver([{ laneIndex: 1, recommended: true }, { laneIndex: 2, recommended: true }]),
      maneuver([{ laneIndex: 1, recommended: true }]),
    ], 1, 0.95, 4);
    expect(plan.steps.map((step) => step.plannedLaneIndex)).toEqual([1, 1, 1]);
    expect(plan.totalLaneChanges).toBe(0);
  });

});
