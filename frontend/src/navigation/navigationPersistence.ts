import { Location, Route3DHighlight } from '../types';
import { NavigationPhase } from './navigationState';

const STORAGE_KEY = 'streept_active_navigation_v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface PersistedNavigationSession {
  destination: Location;
  destinationLabel: string;
  customStart: Location | null;
  startLabel: string;
  routeOptions: Route3DHighlight[];
  selectedRouteIndex: number;
  maneuverIndex: number;
  navigationPhase: NavigationPhase;
  navigationStartedAt: number;
  savedAt: number;
}

const isFiniteLocation = (value: unknown): value is Location => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Location;
  return Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180;
};

export function saveNavigationSession(session: PersistedNavigationSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Persistence is an enhancement; navigation must never depend on it.
  }
}

export function readNavigationSession(): PersistedNavigationSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedNavigationSession>;
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    if (!isFiniteLocation(parsed.destination) || !Array.isArray(parsed.routeOptions) || parsed.routeOptions.length === 0) return null;
    if (parsed.navigationPhase !== 'navigating' && parsed.navigationPhase !== 'rerouting' && parsed.navigationPhase !== 'previewing') return null;
    return {
      destination: parsed.destination,
      destinationLabel: typeof parsed.destinationLabel === 'string' ? parsed.destinationLabel : 'Destination',
      customStart: isFiniteLocation(parsed.customStart) ? parsed.customStart : null,
      startLabel: typeof parsed.startLabel === 'string' ? parsed.startLabel : '',
      routeOptions: parsed.routeOptions,
      selectedRouteIndex: Math.max(0, Math.min((parsed.routeOptions.length - 1), Number.isFinite(parsed.selectedRouteIndex) ? Number(parsed.selectedRouteIndex) : 0)),
      maneuverIndex: Math.max(0, Number.isFinite(parsed.maneuverIndex) ? Number(parsed.maneuverIndex) : 0),
      navigationPhase: parsed.navigationPhase,
      navigationStartedAt: typeof parsed.navigationStartedAt === 'number' ? parsed.navigationStartedAt : Date.now(),
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearNavigationSession(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

export function touchNavigationSession(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.savedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // noop
  }
}
