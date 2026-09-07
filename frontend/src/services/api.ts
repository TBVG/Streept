import axios from 'axios';
import { getLaneRecommendations } from '../navigation/laneIntelligence';
import { Location, Route3DHighlight, ParkingLot, ParkedCar, Report, Billboard, GeocodeResult, SceneContext, TrafficVehicle } from '../types';
import { readStoredRoute, writeStoredRoute, readStoredScene, writeStoredScene, readOfflineTrip, writeOfflineTrip } from '../navigation/offlineStore';
import { SceneBubbleCache, sceneCacheKey, expandScenePrefetchLocations } from '../navigation/sceneStreaming';
import { DEFAULT_SCENE_TILE_ZOOM, sceneTileAddress } from '../navigation/sceneTileAddress';

const API_BASE_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:3001/api');

/** WebSocket endpoint used for live reports/parking updates. */
export const getWebSocketUrl = (): string => {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;

  try {
    const url = new URL(API_BASE_URL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.search = '';
    return url.toString();
  } catch {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
};
const GUEST_ID_STORAGE_KEY = 'streept_guest_id';

/** Creates a local anonymous identity so app features that need a user id
 * (parking check-ins, report voting, etc.) still work without accounts. */
export const getGuestId = (): string => {
  const existing = localStorage.getItem(GUEST_ID_STORAGE_KEY);
  if (existing) return existing;

  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(GUEST_ID_STORAGE_KEY, id);
  return id;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 12000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// The app is intentionally account-free. Send a stable anonymous id so
// per-user features can still distinguish this browser from other browsers.
api.interceptors.request.use((config) => {
  config.headers['X-Guest-ID'] = getGuestId();
  config.headers['X-Client-Request-ID'] = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `req-${Date.now()}`;
  return config;
});


export const getParking = async (destination: Location): Promise<ParkingLot[]> => {
  const response = await api.get(`/parking?destination=${destination.lat},${destination.lng}`);
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to get parking');
};

// These three are called automatically by the app's GPS-based parking
// detection (see NavigationView.tsx) — there's no manual "reserve a spot"
// action anymore. checkinParking marks the current user as parked at a
// lot (incrementing its occupied count); checkoutParking marks them as
// having left; parkingHeartbeat keeps a check-in alive while stationary.

export const getParkedCars = async (location: Location, radius: number = 1200): Promise<ParkedCar[]> => {
  const response = await api.get(`/parking/cars?lat=${location.lat}&lng=${location.lng}&radius=${radius}`);
  if (response.data?.success && Array.isArray(response.data?.data)) return response.data.data;
  throw new Error(response.data?.error?.message || 'Failed to get parked cars');
};

export const checkinParking = async (
  lotId: string,
  location?: Location
): Promise<{ success: boolean; data?: ParkingLot; error?: { error: string; message: string } }> => {
  const response = await api.post('/parking/checkin', { lot_id: lotId, location });
  return response.data;
};

export const parkingHeartbeat = async (location?: Location): Promise<{
  success: boolean;
  error?: { error: string; message: string };
}> => {
  const response = await api.post('/parking/heartbeat', { location });
  return response.data;
};

export const checkoutParking = async (): Promise<{
  success: boolean;
  error?: { error: string; message: string };
}> => {
  const response = await api.post('/parking/checkout');
  return response.data;
};

export const getLiveTraffic = async (location: Location, radius: number = 2500): Promise<Report[]> => {
  const response = await api.get(`/traffic?lat=${location.lat}&lng=${location.lng}&radius=${radius}`, { timeout: 8000 });
  if (response.data?.success && Array.isArray(response.data?.data)) return response.data.data;
  throw new Error(response.data?.error?.message || 'Failed to get live traffic');
};

export const getLiveTrafficVehicles = async (location: Location, radius: number = 2500): Promise<TrafficVehicle[]> => {
  const response = await api.get(`/traffic/vehicles?lat=${location.lat}&lng=${location.lng}&radius=${radius}`, { timeout: 8000 });
  if (response.data?.success && Array.isArray(response.data?.data)) return response.data.data;
  throw new Error(response.data?.error?.message || 'Failed to get live traffic vehicles');
};

export const getReports = async (location: Location, radius: number = 1000): Promise<Report[]> => {
  const response = await api.get(`/reports?lat=${location.lat}&lng=${location.lng}&radius=${radius}`);
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to get reports');
};

export const createReport = async (
  type: string,
  location: Location,
  photoUrl?: string,
  expiresInMinutes?: number
): Promise<Report> => {
  const response = await api.post('/reports', {
    type,
    location,
    photo_url: photoUrl,
    expires_in_minutes: expiresInMinutes,
  });
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to create report');
};

export const confirmReport = async (reportId: string): Promise<Report> => {
  const response = await api.post(`/reports/${reportId}/confirm`);
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to confirm report');
};

export const dismissReport = async (reportId: string): Promise<Report> => {
  const response = await api.post(`/reports/${reportId}/dismiss`);
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to dismiss report');
};

export const getBillboards = async (location: Location, radius: number = 1000): Promise<Billboard[]> => {
  const response = await api.get(`/billboards?lat=${location.lat}&lng=${location.lng}&radius=${radius}`);
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to get billboards');
};

export const purchaseBillboard = async (
  billboardId: string,
  adImageUrl: string,
  adTargetUrl: string,
  displayStart: string,
  displayEnd: string
): Promise<{ success: boolean; data?: Billboard; error?: { error: string; message: string } }> => {
  const response = await api.post(`/billboards/${billboardId}/purchase`, {
    billboard_id: billboardId,
    ad_image_url: adImageUrl,
    ad_target_url: adTargetUrl,
    display_start: displayStart,
    display_end: displayEnd,
  });
  return response.data;
};

export const clickBillboard = async (billboardId: string): Promise<number | null> => {
  const response = await api.post(`/billboards/${billboardId}/click`);
  return response.data.success ? response.data.data : null;
};

type OsrmRouteResponse = {
  code?: string;
  message?: string;
  routes?: Array<{
    geometry?: { coordinates?: number[][] };
    duration?: number;
    distance?: number;
    legs?: Array<{
      steps?: Array<{
        name?: string;
        maneuver?: {
          type?: string;
          modifier?: string;
          location?: number[];
          bearing_before?: number;
        };
        intersections?: Array<{
          lanes?: Array<{ indications?: string[]; valid?: boolean }>;
          driving_side?: 'left' | 'right';
        }>;
      }>;
    }>;
  }>;
};

const isComplexManeuver = (type: string, modifier?: string): boolean => {
  if (!['turn', 'roundabout', 'rotary', 'merge', 'fork', 'end of road', 'on ramp', 'off ramp'].includes(type)) return false;
  return !(type === 'turn' && modifier === 'straight');
};

const parseOsrmRoutes = (payload: OsrmRouteResponse): Route3DHighlight[] => {
  if (payload.code !== 'Ok' || !payload.routes?.length) return [];

  return payload.routes.flatMap((route) => {
    const coordinates = route.geometry?.coordinates || [];
    const coords = coordinates.flatMap((c) => {
      if (c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return [];
      return [{ lat: c[1], lng: c[0], alt: 0 }];
    });
    if (!coords.length) return [];

    const maneuvers = (route.legs || []).flatMap((leg) => (leg.steps || []).flatMap((step) => {
      const m = step.maneuver;
      if (!m?.location || m.location.length < 2) return [];
      const type = m.type || '';
      const modifier = m.modifier || null;
      const intersections = step.intersections || [];
      const last = intersections[intersections.length - 1];
      const lanes = last?.lanes?.length
        ? last.lanes.map((lane) => ({ indications: lane.indications || [], valid: lane.valid === true }))
        : undefined;
      const road = step.name?.trim();
      const instruction = road ? `${type || 'Continue'} onto ${road}` : (type || 'Continue');
      const maneuver = {
        type,
        modifier,
        location: { lat: m.location[1], lng: m.location[0] },
        bearing_before: Number.isFinite(m.bearing_before) ? (m.bearing_before as number) : 0,
        instruction,
        is_complex: isComplexManeuver(type, modifier || undefined),
        lanes,
      };
      const rankedLanes = lanes ? getLaneRecommendations(maneuver).map((lane) => ({
        ...maneuver.lanes![lane.laneIndex],
        recommended: lane.preferred,
        confidence: lane.score,
      })) : undefined;
      return [{ ...maneuver, lanes: rankedLanes }];
    }));

    return [{
      segments: [{
        coords,
        is_highlighted: true,
        color: '#2D7FF9',
        lane_index: null,
      }],
      maneuvers,
      duration_seconds: typeof route.duration === 'number' ? route.duration : null,
      distance_meters: typeof route.distance === 'number' ? route.distance : null,
    }];
  });
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function getWithRetry<T>(request: () => Promise<{ data: T }>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await request();
      return response.data;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(250 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Network request failed');
}

const getRouteDirectFromOsrm = async (from: Location, to: Location): Promise<Route3DHighlight[]> => {
  // Browser fallback: this keeps trip planning functional even when the
  // optional Streept backend is unavailable. OSRM documents this route shape
  // and supports GeoJSON geometry + turn steps over its HTTP API.
  const url = `https://router.project-osrm.org/route/v1/driving/${encodeURIComponent(`${from.lng},${from.lat};${to.lng},${to.lat}`)}?overview=full&geometries=geojson&steps=true&alternatives=2`;
  const data = await getWithRetry<OsrmRouteResponse>(() => axios.get<OsrmRouteResponse>(url, { timeout: 9000 }), 2);
  return parseOsrmRoutes(data);
};

const ROUTE_CACHE_KEY = 'streept_route_cache_v2';
const ROUTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ROUTE_CACHE_MAX_ENTRIES = 24;

const routeCacheKey = (from: Location, to: Location): string => {
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return `${round(from.lat)},${round(from.lng)}>${round(to.lat)},${round(to.lng)}`;
};
const parseCacheKey = (key: string): { from: Location; to: Location } => {
  const [a, b] = key.split('>');
  const [flat, flng] = (a || '').split(',').map(Number);
  const [tlat, tlng] = (b || '').split(',').map(Number);
  return { from: { lat: flat, lng: flng }, to: { lat: tlat, lng: tlng } };
};

const readRouteCache = (key: string): Route3DHighlight[] | null => {
  try {
    const raw = localStorage.getItem(ROUTE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, { savedAt: number; routes: Route3DHighlight[]; from?: Location; to?: Location }>;
    const entry = parsed[key];
    if (!entry || Date.now() - entry.savedAt > ROUTE_CACHE_TTL_MS || !Array.isArray(entry.routes) || entry.routes.length === 0) return null;
    return entry.routes;
  } catch {
    return null;
  }
};

const writeRouteCache = (key: string, routes: Route3DHighlight[]): void => {
  try {
    const raw = localStorage.getItem(ROUTE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, { savedAt: number; routes: Route3DHighlight[]; from?: Location; to?: Location }> : {};
    parsed[key] = { savedAt: Date.now(), routes, from: parseCacheKey(key).from, to: parseCacheKey(key).to };
    const entries = Object.entries(parsed).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, ROUTE_CACHE_MAX_ENTRIES);
    localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Cache is an optimization, never a reason to fail routing.
  }
};

const rankRoutes = (routes: Route3DHighlight[]): Route3DHighlight[] => {
  return [...routes].sort((a, b) => {
    const timeA = a.duration_seconds ?? Number.POSITIVE_INFINITY;
    const timeB = b.duration_seconds ?? Number.POSITIVE_INFINITY;
    const distanceA = a.distance_meters ?? Number.POSITIVE_INFINITY;
    const distanceB = b.distance_meters ?? Number.POSITIVE_INFINITY;
    const maneuversA = a.maneuvers.length;
    const maneuversB = b.maneuvers.length;
    const complexityA = a.maneuvers.filter((m) => m.is_complex).length;
    const complexityB = b.maneuvers.filter((m) => m.is_complex).length;
    const scoreA = timeA + distanceA * 0.045 + maneuversA * 5 + complexityA * 8;
    const scoreB = timeB + distanceB * 0.045 + maneuversB * 5 + complexityB * 8;
    return scoreA - scoreB;
  });
};


const readNearestCachedRoute = (from: Location, to: Location): Route3DHighlight[] | null => {
  try {
    const raw = localStorage.getItem(ROUTE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, { savedAt: number; routes: Route3DHighlight[]; from?: Location; to?: Location }>;
    let best: { score: number; routes: Route3DHighlight[] } | null = null;
    for (const entry of Object.values(parsed)) {
      if (!entry?.routes?.length || !entry.from || !entry.to) continue;
      const age = Date.now() - entry.savedAt;
      if (age > ROUTE_CACHE_TTL_MS) continue;
      const dFrom = Math.hypot(entry.from.lat - from.lat, entry.from.lng - from.lng);
      const dTo = Math.hypot(entry.to.lat - to.lat, entry.to.lng - to.lng);
      const score = dFrom + dTo;
      if (!best || score < best.score) best = { score, routes: entry.routes };
    }
    return best && best.score < 0.08 ? best.routes : null;
  } catch {
    return null;
  }
};


export interface OfflineTripPlan {
  version: number;
  scope: string;
  from: Location;
  to: Location;
  distance_km: number;
  providers: { routing: string; scene: string; traffic: string };
  note: string;
}

export const getOfflineTripPlan = async (from: Location, to: Location): Promise<OfflineTripPlan> => {
  const response = await api.get(`/offline/plan?from=${encodeURIComponent(`${from.lat},${from.lng}`)}&to=${encodeURIComponent(`${to.lat},${to.lng}`)}`, { timeout: 7000 });
  if (response.data?.success && response.data?.data) return response.data.data as OfflineTripPlan;
  throw new Error(response.data?.error?.message || 'Offline trip preparation is unavailable.');
};

export const prepareOfflineTrip = async (from: Location, to: Location): Promise<void> => {
  const routes = await getRoute(from, to);
  const sceneLocations = routes
    .flatMap((route) => route.maneuvers)
    .map((maneuver) => maneuver.location)
    .slice(0, 18);
  const scenes: Record<string, SceneContext> = {};
  for (const location of sceneLocations) {
    try {
      const scene = await getSceneContext(location);
      scenes[sceneCacheKey(location, 220)] = scene;
    } catch {
      // Offline preparation is best-effort; the route itself remains useful.
    }
  }
  await writeOfflineTrip(from, to, routes, scenes);
};

export const readPreparedOfflineTrip = async (from: Location, to: Location) =>
  readOfflineTrip(from, to, 24 * 60 * 60 * 1000);

export const getRoute = async (from: Location, to: Location): Promise<Route3DHighlight[]> => {
  const key = routeCacheKey(from, to);
  const cached = readRouteCache(key);
  if (cached) return cached;
  // IndexedDB survives larger route payloads better than localStorage and
  // remains available when the network is unavailable. LocalStorage remains
  // the synchronous fast path above.
  const persisted = await readStoredRoute(key, ROUTE_CACHE_TTL_MS);
  if (persisted) {
    writeRouteCache(key, persisted);
    return persisted;
  }

  let backendError: unknown = null;
  try {
    const response = await api.get(`/route?from=${encodeURIComponent(`${from.lat},${from.lng}`)}&to=${encodeURIComponent(`${to.lat},${to.lng}`)}`, { timeout: 12000 });
    if (response.data?.success && Array.isArray(response.data?.data?.routes) && response.data.data.routes.length) {
      const routes = rankRoutes(response.data.data.routes);
      writeRouteCache(key, routes);
      void writeStoredRoute(key, from, to, routes);
      return routes;
    }
    backendError = new Error(response.data?.error?.message || 'The routing service returned no route');
  } catch (error) {
    backendError = error;
  }

  try {
    const directRoutes = await getRouteDirectFromOsrm(from, to);
    if (directRoutes.length) {
      const routes = rankRoutes(directRoutes);
      writeRouteCache(key, routes);
      void writeStoredRoute(key, from, to, routes);
      return routes;
    }
  } catch (directError) {
    console.error('Direct OSRM fallback failed:', directError);
  }

  // Last-resort offline continuity: when both network routing paths are
  // unavailable, reuse a recent route only when both endpoints are still
  // geographically close. This keeps a transient outage from destroying a
  // usable trip while avoiding a wildly stale route for an unrelated trip.
  const nearbyCached = readNearestCachedRoute(from, to);
  if (nearbyCached) return nearbyCached;
  const persistedNearby = await readStoredRoute(key, ROUTE_CACHE_TTL_MS);
  if (persistedNearby) return persistedNearby;

  const message = backendError instanceof Error ? backendError.message : 'Failed to get route';
  throw new Error(message);
};

const sceneCache = new SceneBubbleCache();

const readScenePayload = (payload: any): SceneContext | null => {
  if (payload?.success && payload?.data) return payload.data as SceneContext;
  if (payload?.roads || payload?.buildings || payload?.signals) return payload as SceneContext;
  return null;
};

const fetchSceneTile = async (location: Location): Promise<SceneContext | null> => {
  const address = sceneTileAddress(location, DEFAULT_SCENE_TILE_ZOOM);
  if (!address) return null;

  // Optional immutable object-store/CDN delivery. The URL is a template so
  // Cloud Storage, S3, a CDN, or a self-hosted static bucket can all work.
  const cdnTemplate = import.meta.env.VITE_SCENE_TILE_URL;
  if (cdnTemplate) {
    try {
      const url = cdnTemplate.replace('{z}', String(DEFAULT_SCENE_TILE_ZOOM))
        .replace('{x}', address.split('/')[1]).replace('{y}', address.split('/')[2]);
      const payload = await getWithRetry(() => axios.get(url, { timeout: 7000 }), 1);
      const scene = readScenePayload(payload);
      if (scene) return scene;
    } catch {
      // Fall through to the API-hosted tile and then development fallback.
    }
  }

  try {
    const payload = await getWithRetry(() => api.get(`/scene-tile?lat=${location.lat}&lng=${location.lng}&zoom=${DEFAULT_SCENE_TILE_ZOOM}`, { timeout: 7000 }), 1);
    return readScenePayload(payload);
  } catch {
    return null;
  }
};

export const getSceneContext = async (location: Location, radius: number = 220): Promise<SceneContext> => {
  const key = sceneCacheKey(location, radius);
  const cached = sceneCache.get(key);
  if (cached) return cached;
  const persisted = await readStoredScene(key, 10 * 60 * 1000);
  if (persisted) {
    sceneCache.set(key, persisted);
    return persisted;
  }

  const tile = await fetchSceneTile(location);
  if (tile) {
    sceneCache.set(key, tile);
    void writeStoredScene(key, tile);
    return tile;
  }

  const response = await getWithRetry(() => api.get(`/scene-context?lat=${location.lat}&lng=${location.lng}&radius=${radius}`, { timeout: 11000 }), 2);
  const scene = readScenePayload(response);
  if (scene) {
    sceneCache.set(key, scene);
    void writeStoredScene(key, scene);
    return scene;
  }
  const error = (response as { error?: { message?: string } } | null)?.error;
  throw new Error(error?.message || 'Failed to load immersive scene');
};

export const prefetchSceneContext = (locations: Location[], radius: number = 220): void => {
  const expanded = expandScenePrefetchLocations(locations.slice(0, 3), Math.min(radius, 220));
  const unique = new Map<string, Location>();
  for (const location of expanded) unique.set(sceneCacheKey(location, radius), location);
  for (const location of [...unique.values()].slice(0, 12)) {
    getSceneContext(location, radius).catch(() => {
      // Prefetch is opportunistic. The immersive view retries on demand.
    });
  }
};

type PhotonSearchResponse = {
  features?: Array<{
    geometry?: { coordinates?: number[] };
    properties?: {
      name?: string; street?: string; housenumber?: string; postcode?: string;
      city?: string; district?: string; state?: string; country?: string;
    };
  }>;
};

const searchPhotonDirect = async (query: string, near?: Location): Promise<GeocodeResult[]> => {
  const params = new URLSearchParams({ q: query, limit: '8', lang: 'en' });
  if (near) {
    params.set('lat', String(near.lat));
    params.set('lon', String(near.lng));
    params.set('zoom', '10');
    params.set('location_bias_scale', '0.15');
  }
  const data = await getWithRetry<PhotonSearchResponse>(() => axios.get<PhotonSearchResponse>(`https://photon.komoot.io/api?${params.toString()}`, { timeout: 5000 }), 2);
  return (data.features || []).flatMap((feature: NonNullable<PhotonSearchResponse['features']>[number]) => {
    const coords = feature.geometry?.coordinates;
    const p = feature.properties || {};
    if (!coords || coords.length < 2 || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return [];
    const primary = p.name || p.street;
    if (!primary) return [];
    const parts = [primary];
    if (p.name && p.housenumber) parts.push(p.housenumber);
    for (const value of [p.district, p.city, p.state, p.country, p.postcode]) {
      if (value && !parts.includes(value)) parts.push(value);
    }
    return [{ display_name: parts.join(', '), location: { lat: coords[1], lng: coords[0] } }];
  });
};

export const searchPlaces = async (query: string, near?: Location): Promise<GeocodeResult[]> => {
  const params = new URLSearchParams({ q: query });
  if (near) { params.set('lat', String(near.lat)); params.set('lng', String(near.lng)); }
  try {
    const response = await api.get(`/geocode?${params.toString()}`);
    if (response.data.success && response.data.data?.length) return response.data.data;
    // A backend geocoder can temporarily be unable to reach its public
    // provider. The browser fallback keeps search usable in that case.
    return await searchPhotonDirect(query, near);
  } catch (error) {
    try {
      return await searchPhotonDirect(query, near);
    } catch {
      throw error;
    }
  }
};

// Recent destinations — purely client-side (localStorage), no backend
// involved. Capped at a handful of entries so the dropdown stays scannable
// and doesn't grow forever.
const RECENT_DESTINATIONS_KEY = 'streept_recent_destinations';
const MAX_RECENT_DESTINATIONS = 6;

export const getRecentDestinations = (): GeocodeResult[] => {
  try {
    const raw = localStorage.getItem(RECENT_DESTINATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const addRecentDestination = (result: GeocodeResult): void => {
  try {
    const existing = getRecentDestinations().filter((r) => r.display_name !== result.display_name);
    const updated = [result, ...existing].slice(0, MAX_RECENT_DESTINATIONS);
    localStorage.setItem(RECENT_DESTINATIONS_KEY, JSON.stringify(updated));
  } catch {
    // localStorage can throw (private browsing, quota) — recents are a
    // convenience, not worth surfacing an error for.
  }
};

