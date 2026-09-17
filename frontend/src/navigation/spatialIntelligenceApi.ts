import { SpatialObservation } from './observationLedger';

const API_BASE_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:3001/api');

const guestId = (): string => {
  const key = 'streept_guest_id';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return 'anonymous';
  }
};

const readApiError = async (response: Response, fallback: string): Promise<Error> => {
  try {
    const body = await response.json();
    return new Error(body?.error?.message || body?.message || `${fallback} (${response.status})`);
  } catch {
    return new Error(`${fallback} (${response.status})`);
  }
};

export interface RoadIntelligenceAggregate {
  way_id: number; observations: number; completed: number; missed: number;
  lane_misalignments: number; hazards: number; miss_rate: number;
  lane_misalignment_rate: number; hazard_rate: number; score: number; confidence: number;
}

export const syncSpatialObservations = async (observations: SpatialObservation[]): Promise<number> => {
  if (!observations.length) return 0;
  const response = await fetch(`${API_BASE_URL}/spatial-observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Guest-ID': guestId() },
    body: JSON.stringify({ observations: observations.map((o) => ({
      id: o.id, at: new Date(o.at).toISOString(), observation_type: o.type,
      route_generation: o.routeGeneration, maneuver_key: o.maneuverKey, way_id: o.wayId,
      maneuver: o.maneuver, lane_alignment: o.laneAlignment, confidence: o.confidence,
    })) }),
  });
  if (!response.ok) throw new Error(`spatial sync failed (${response.status})`);
  const data = await response.json();
  if (!data?.success) throw new Error(data?.error?.message || 'spatial sync failed');
  return Number(data?.data?.accepted ?? 0);
};

export const getRoadIntelligence = async (wayId: number, days = 30): Promise<RoadIntelligenceAggregate | null> => {
  if (!Number.isFinite(wayId) || wayId <= 0) return null;
  const url = `${API_BASE_URL}/road-intelligence?way_id=${Math.trunc(wayId)}&days=${Math.max(1, Math.min(30, Math.trunc(days)))}`;
  const response = await fetch(url, { headers: { 'X-Guest-ID': guestId() } });
  if (!response.ok) throw await readApiError(response, 'road intelligence failed');
  const data = await response.json();
  return data?.success ? data.data : null;
};

/** Fetches community intelligence for an entire planned road sequence in one request. */

export interface RoadIntelligenceTemporalBucket {
  way_id: number; weekday: number; hour: number; observations: number; score: number; confidence: number;
}

export const getRoadIntelligenceTemporal = async (wayIds: number[], days = 30): Promise<RoadIntelligenceTemporalBucket[]> => {
  const ids = Array.from(new Set(wayIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.trunc(id)))).slice(0, 128);
  if (!ids.length) return [];
  const url = `${API_BASE_URL}/road-intelligence/temporal?way_ids=${encodeURIComponent(ids.join(','))}&days=${Math.max(1, Math.min(30, Math.trunc(days)))}`;
  const response = await fetch(url, { headers: { 'X-Guest-ID': guestId() } });
  if (!response.ok) throw await readApiError(response, 'road intelligence temporal failed');
  const data = await response.json();
  return data?.success && Array.isArray(data.data) ? data.data : [];
};

export const getRoadIntelligenceBatch = async (wayIds: number[], days = 30): Promise<RoadIntelligenceAggregate[]> => {
  const ids = Array.from(new Set(wayIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.trunc(id)))).slice(0, 128);
  if (!ids.length) return [];
  const url = `${API_BASE_URL}/road-intelligence/batch?way_ids=${encodeURIComponent(ids.join(','))}&days=${Math.max(1, Math.min(30, Math.trunc(days)))}`;
  const response = await fetch(url, { headers: { 'X-Guest-ID': guestId() } });
  if (!response.ok) throw await readApiError(response, 'road intelligence batch failed');
  const data = await response.json();
  return data?.success && Array.isArray(data.data) ? data.data : [];
};
