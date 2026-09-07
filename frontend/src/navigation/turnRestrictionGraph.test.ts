import { describe, expect, it } from 'vitest';
import { deriveSceneWaySequence, evaluateNextWayRestriction, evaluateTurnRestriction } from './turnRestrictionGraph';

const base = { osm_id: 1, restriction: 'no_right_turn', from_way_ids: [10], to_way_ids: [20], via_node_ids: [99] };

describe('turnRestrictionGraph', () => {
  it('blocks a matching no-turn relation', () => {
    expect(evaluateTurnRestriction([base], 10, 20, 99).decision).toBe('prohibited');
  });

  it('allows an unrelated outgoing way', () => {
    expect(evaluateTurnRestriction([base], 10, 21, 99).decision).toBe('allowed');
  });

  it('enforces only-turn relations by excluding other ways', () => {
    const restriction = { ...base, osm_id: 2, restriction: 'only_straight_on' };
    expect(evaluateTurnRestriction([restriction], 10, 21, 99).decision).toBe('prohibited');
    expect(evaluateTurnRestriction([restriction], 10, 20, 99).decision).toBe('allowed');
  });

  it('does not apply a relation with a different via node', () => {
    expect(evaluateTurnRestriction([base], 10, 20, 100).decision).toBe('allowed');
  });

  it('leaves multi-way relations unresolved rather than guessing', () => {
    const restriction = { ...base, via_node_ids: [], via_way_ids: [30] };
    expect(evaluateTurnRestriction([restriction], 10, 20, 99).decision).toBe('unresolved');
  });
});


describe('evaluateNextWayRestriction', () => {
  it('blocks a multi-way no restriction after the via way', () => {
    const restriction = {
      osm_id: 500, restriction: 'no_right_turn', from_way_ids: [10], to_way_ids: [30], via_way_ids: [20],
    };
    expect(evaluateNextWayRestriction([restriction], [10, 20], 30).decision).toBe('prohibited');
    expect(evaluateNextWayRestriction([restriction], [10, 20], 31).decision).toBe('allowed');
  });

  it('enforces a multi-way only restriction', () => {
    const restriction = {
      osm_id: 501, restriction: 'only_straight_on', from_way_ids: [10], to_way_ids: [30], via_way_ids: [20],
    };
    expect(evaluateNextWayRestriction([restriction], [10, 20], 31).decision).toBe('prohibited');
    expect(evaluateNextWayRestriction([restriction], [10, 20], 30).decision).toBe('allowed');
  });
});

describe('route-wide restriction graph', () => {
  it('derives an ordered scene way sequence from route samples', () => {
    const roads = [
      { osm_id: 10, geometry: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }] },
      { osm_id: 20, geometry: [{ lat: 0, lng: 0.001 }, { lat: 0.001, lng: 0.001 }] },
    ];
    expect(deriveSceneWaySequence([
      { lat: 0, lng: 0 }, { lat: 0, lng: 0.0008 }, { lat: 0.0005, lng: 0.001 },
    ], roads)).toEqual([10, 20]);
  });
});
