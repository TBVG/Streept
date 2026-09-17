import { describe, expect, it } from 'vitest';
import { deriveIntersectionIntelligence } from './intersectionIntelligence';
import { Maneuver } from '../types';

const maneuver = (overrides: Partial<Maneuver> = {}): Maneuver => ({
  type: 'turn', modifier: 'left', location: { lat: 1, lng: 2 },
  bearing_before: 0, instruction: 'Turn left', is_complex: false, ...overrides,
});

describe('intersection intelligence', () => {
  it('classifies complex roundabouts and provides preparation distance', () => {
    const result = deriveIntersectionIntelligence(maneuver({ type: 'roundabout', instruction: 'Enter roundabout' }), null, null, 80);
    expect(result.kind).toBe('roundabout');
    expect(result.complexity).toBe('complex');
    expect(result.laneChangeAllowedInsideJunction).toBe(false);
    expect(result.preparationDistanceMeters).toBeGreaterThan(0);
  });

  it('keeps an ordinary turn simple', () => {
    const result = deriveIntersectionIntelligence(maneuver(), null, null, 100);
    expect(result.kind).toBe('unknown');
    expect(result.behavior).toBe('turn');
    expect(result.complexity).toBe('simple');
  });

  it('returns unknown when there is no upcoming maneuver', () => {
    expect(deriveIntersectionIntelligence(null, null, null, null).kind).toBe('unknown');
  });
});
