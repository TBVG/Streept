import { describe, expect, it } from 'vitest';
import { validateRoute } from './productionQa';

describe('production QA route validation', () => {
  it('accepts both segmented and legacy coordinate routes', () => {
    expect(validateRoute({ coordinates: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }] } as any)).toBe(true);
    expect(validateRoute({ segments: [{ coords: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }] }] } as any)).toBe(true);
  });

  it('rejects malformed coordinates', () => {
    expect(validateRoute({ coordinates: [{ lat: 91, lng: 0 }, { lat: 0, lng: 0 }] } as any)).toBe(false);
  });
});
