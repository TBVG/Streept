export type NavigationMetricName =
  | 'route_requested'
  | 'route_succeeded'
  | 'route_failed'
  | 'reroute_requested'
  | 'reroute_succeeded'
  | 'gps_stale'
  | 'gps_rejected'
  | 'navigation_started'
  | 'navigation_arrived'
  | 'immersive_entered'
  | 'immersive_exited'
  | 'traffic_refresh_failed'
  | 'gps_quality_changed'
  | 'offline_fallback_used'
  | 'route_rank_changed'
  | 'scene_preload_failed'
  | 'maneuver_completed'
  | 'maneuver_missed';

export interface NavigationMetric {
  id: string;
  name: NavigationMetricName;
  at: number;
  sessionId?: string;
  value?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

const STORAGE_KEY = 'streept_nav_telemetry_v1';
const MAX_EVENTS = 240;
const SESSION_KEY = 'streept_nav_session_id';

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getNavigationSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = randomId('nav');
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return randomId('nav');
  }
}

export function recordNavigationMetric(name: NavigationMetricName, value?: number, metadata?: NavigationMetric['metadata']): void {
  try {
    const event: NavigationMetric = {
      id: randomId('evt'),
      name,
      at: Date.now(),
      sessionId: getNavigationSessionId(),
      value,
      metadata,
    };
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const events = Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS + 1) : [];
    events.push(event);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Telemetry is best-effort and must never affect navigation.
  }
}

export function clearNavigationTelemetry(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
