import { GeocodeResult, Location } from '../types';

const KEY = 'streept_saved_places_v1';
const MAX = 30;

export interface SavedPlace extends GeocodeResult {
  id: string;
  savedAt: number;
}

function validLocation(value: unknown): value is Location {
  if (!value || typeof value !== 'object') return false;
  const v = value as Location;
  return Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180;
}

function read(): SavedPlace[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedPlace =>
      !!item && typeof item === 'object' &&
      typeof (item as SavedPlace).id === 'string' &&
      typeof (item as SavedPlace).display_name === 'string' &&
      validLocation((item as SavedPlace).location) &&
      Number.isFinite((item as SavedPlace).savedAt)
    ).slice(0, MAX);
  } catch { return []; }
}

function write(items: SavedPlace[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX))); } catch { /* enhancement only */ }
}

export function getSavedPlaces(): SavedPlace[] { return read(); }

export function isSavedPlace(location: Location): boolean {
  return read().some(p => Math.abs(p.location.lat - location.lat) < 1e-5 && Math.abs(p.location.lng - location.lng) < 1e-5);
}

export function savePlace(result: GeocodeResult): SavedPlace {
  const existing = read().find(p => Math.abs(p.location.lat - result.location.lat) < 1e-5 && Math.abs(p.location.lng - result.location.lng) < 1e-5);
  if (existing) return existing;
  const item: SavedPlace = { ...result, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: Date.now() };
  write([item, ...read()]);
  return item;
}

export function removeSavedPlace(id: string): void { write(read().filter(p => p.id !== id)); }
