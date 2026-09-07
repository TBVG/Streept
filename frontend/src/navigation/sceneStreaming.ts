import { Location, SceneContext } from '../types';

export type SceneCacheEntry = { savedAt: number; lastUsedAt: number; scene: SceneContext };

export const SCENE_CACHE_TTL_MS = 10 * 60 * 1000;
export const SCENE_CACHE_MAX_ENTRIES = 48;

export const sceneCacheKey = (location: Location, radius: number) =>
  `${location.lat.toFixed(4)},${location.lng.toFixed(4)},${Math.round(radius)}`;

/** Small deterministic LRU cache for street-level scene bubbles. */
export class SceneBubbleCache {
  private entries = new Map<string, SceneCacheEntry>();
  constructor(private readonly maxEntries = SCENE_CACHE_MAX_ENTRIES, private readonly ttlMs = SCENE_CACHE_TTL_MS) {}

  get(key: string, now = Date.now()): SceneContext | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (now - entry.savedAt >= this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    entry.lastUsedAt = now;
    return entry.scene;
  }

  set(key: string, scene: SceneContext, now = Date.now()): void {
    this.entries.set(key, { savedAt: now, lastUsedAt: now, scene });
    this.evict();
  }

  delete(key: string): void { this.entries.delete(key); }
  clear(): void { this.entries.clear(); }
  size(): number { return this.entries.size; }

  keys(): string[] { return [...this.entries.keys()]; }

  private evict(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.savedAt >= this.ttlMs) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
      if (!oldest) break;
      this.entries.delete(oldest[0]);
    }
  }
}

/** Returns a compact ring of nearby points for streaming a local high-detail bubble. */
export const expandScenePrefetchLocations = (locations: Location[], radiusMeters: number): Location[] => {
  const offsets = [
    [0, 0], [radiusMeters * 0.55, 0], [-radiusMeters * 0.55, 0],
    [0, radiusMeters * 0.55], [0, -radiusMeters * 0.55],
  ];
  const latScale = 111_320;
  const result: Location[] = [];
  for (const location of locations) {
    for (const [east, north] of offsets) {
      const lat = location.lat + north / latScale;
      const lng = location.lng + east / (latScale * Math.max(0.2, Math.cos(location.lat * Math.PI / 180)));
      result.push({ lat, lng });
    }
  }
  return result;
};
