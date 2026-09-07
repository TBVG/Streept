import { buildLegalLaneTransitions, shortestLegalLaneSequence } from './laneIntersectionIntelligence';
import { Maneuver } from '../types';

const maneuver = (lanes: Maneuver['lanes']): Maneuver => ({
  type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 0,
  instruction: 'Turn right', is_complex: true, lanes,
});

describe('lane intersection intelligence', () => {
  it('respects explicit no-right lane-change permissions', () => {
    const plan = buildLegalLaneTransitions(maneuver([
      { indications: ['through'], valid: true, change: 'not_right' },
      { indications: ['right'], valid: true },
    ]));
    expect(plan.transitions.find((t) => t.fromLane === 0 && t.toLane === 1)?.legal).toBe(false);
    expect(shortestLegalLaneSequence(plan, 0, 1)).toBeNull();
  });

  it('allows adjacent legal transitions', () => {
    const plan = buildLegalLaneTransitions(maneuver([
      { indications: ['through'], valid: true, change: 'yes' },
      { indications: ['right'], valid: true, change: 'yes' },
      { indications: ['right'], valid: true, change: 'yes' },
    ]));
    expect(shortestLegalLaneSequence(plan, 0, 2)).toEqual([0, 1, 2]);
  });
});
