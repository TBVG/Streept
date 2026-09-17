import { Location } from '../types';

const CACHE_NAME = 'streept-map-tiles-v1';
const MAX_TILES = 360;
const ZOOMS = [12, 13, 14, 15, 16];
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';

function tileXY(location: Location, zoom: number): [number, number] {
  const n = 2 ** zoom;
  const x = Math.max(0, Math.min(n - 1, Math.floor(((location.lng + 180) / 360) * n)));
  const lat = Math.max(-85.05112878, Math.min(85.05112878, location.lat));
  const rad = lat * Math.PI / 180;
  const y = Math.max(0, Math.min(n - 1, Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n)));
  return [x, y];
}

function url(z: number, x: number, y: number): string { return TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)); }

/** Best-effort prefetch of a bounded route corridor for offline map continuity. */
export async function cacheRouteMapTiles(points: Location[]): Promise<number> {
  if (import.meta.env.VITE_OFFLINE_MAP_CACHE === 'false' || typeof caches === 'undefined' || !points.length) return 0;
  const unique = new Set<string>();
  for (const point of points) {
    for (const z of ZOOMS) {
      const [x, y] = tileXY(point, z);
      unique.add(`${z}/${x}/${y}`);
      if (unique.size >= MAX_TILES) break;
    }
    if (unique.size >= MAX_TILES) break;
  }
  try {
    const cache = await caches.open(CACHE_NAME);
    let stored = 0;
    for (const key of unique) {
      const [z, x, y] = key.split('/').map(Number);
      const request = new Request(url(z, x, y), { mode: 'no-cors' });
      if (await cache.match(request)) continue;
      try {
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') { await cache.put(request, response.clone()); stored += 1; }
      } catch { /* one unavailable tile must not block route caching */ }
    }
    return stored;
  } catch { return 0; }
}

export async function clearOfflineMapTiles(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
}
