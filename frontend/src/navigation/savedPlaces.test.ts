import { describe, expect, it, beforeEach } from 'vitest';
import { getSavedPlaces, isSavedPlace, savePlace, removeSavedPlace } from './savedPlaces';

const place = { display_name: 'Test place', location: { lat: 43, lng: -78 } };
beforeEach(() => localStorage.clear());

describe('saved places', () => {
  it('saves and reloads places', () => { savePlace(place); expect(getSavedPlaces()).toHaveLength(1); expect(isSavedPlace(place.location)).toBe(true); });
  it('deduplicates the same coordinates', () => { savePlace(place); savePlace({ ...place, display_name: 'Renamed place' }); expect(getSavedPlaces()).toHaveLength(1); });
  it('removes a saved place', () => { const saved = savePlace(place); removeSavedPlace(saved.id); expect(getSavedPlaces()).toHaveLength(0); });
});
