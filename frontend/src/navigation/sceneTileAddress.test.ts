import { describe, expect, it } from 'vitest';
import { sceneTileAddress } from './sceneTileAddress';

describe('sceneTileAddress', () => {
  it('returns deterministic Web-Mercator addresses', () => {
    expect(sceneTileAddress({ lat: 0, lng: 0 }, 2)).toBe('2/2/2');
    expect(sceneTileAddress({ lat: 40.7128, lng: -74.006 }, 17)).toBe(sceneTileAddress({ lat: 40.7128, lng: -74.006 }, 17));
  });

  it('rejects invalid coordinates', () => {
    expect(sceneTileAddress({ lat: Number.NaN, lng: 0 })).toBeNull();
    expect(sceneTileAddress({ lat: 91, lng: 0 })).toBeNull();
  });
});
