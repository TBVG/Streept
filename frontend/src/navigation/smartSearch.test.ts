import { describe, expect, it } from 'vitest';
import { detectSearchIntent, normalizeSearchQuery, smartSearch, wantsRouteSearch, wantsDestinationSearch } from './smartSearch';

describe('smart search intent', () => {
  it('recognizes useful driver categories', () => {
    expect(detectSearchIntent('coffee near me')).toBe('coffee');
    expect(detectSearchIntent('petrol station')).toBe('fuel');
    expect(detectSearchIntent('EV charger')).toBe('ev');
    expect(detectSearchIntent('parking')).toBe('parking');
  });

  it('removes context/filter language before provider search', () => {
    expect(normalizeSearchQuery('cheap coffee near me')).toBe('coffee');
    expect(normalizeSearchQuery('good restaurant on my route')).toBe('restaurant');
  });

  it('detects route-aware intent', () => {
    expect(wantsRouteSearch('coffee on my route')).toBe(true);
    expect(wantsRouteSearch("gas don't detour")).toBe(true);
    expect(wantsRouteSearch('coffee near me')).toBe(false);
    expect(wantsDestinationSearch('coffee near destination')).toBe(true);
  });

  it('returns empty results for an empty query without touching the provider', async () => {
    await expect(smartSearch('')).resolves.toEqual([]);
  });
});
