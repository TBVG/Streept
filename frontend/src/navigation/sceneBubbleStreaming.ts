import { Location, SceneContext } from '../types';
import { SceneBubbleCache, sceneCacheKey } from './sceneStreaming';

export interface SceneBubbleStreamOptions {
  radiusMeters?: number;
  refreshDistanceMeters?: number;
  maxCacheEntries?: number;
}

export interface SceneBubbleStreamState {
  center: Location | null;
  scene: SceneContext | null;
  loading: boolean;
  generation: number;
}

const DEFAULT_RADIUS_METERS = 220;
const DEFAULT_REFRESH_DISTANCE_METERS = 120;

const distanceMeters = (a: Location, b: Location): number => {
  const latScale = 111_320;
  const lngScale = latScale * Math.max(0.2, Math.cos(a.lat * Math.PI / 180));
  return Math.hypot((a.lat - b.lat) * latScale, (a.lng - b.lng) * lngScale);
};

/**
 * Coordinates local scene delivery independently from Cesium. A bubble is
 * fetched only after the driver has moved far enough from the last bubble
 * center, and an in-flight older request can never overwrite a newer one.
 */
export class SceneBubbleStreamer {
  private readonly cache: SceneBubbleCache;
  private readonly radiusMeters: number;
  private readonly refreshDistanceMeters: number;
  private center: Location | null = null;
  private generation = 0;
  private loading = false;

  constructor(options: SceneBubbleStreamOptions = {}) {
    this.cache = new SceneBubbleCache(options.maxCacheEntries);
    this.radiusMeters = options.radiusMeters ?? DEFAULT_RADIUS_METERS;
    this.refreshDistanceMeters = options.refreshDistanceMeters ?? DEFAULT_REFRESH_DISTANCE_METERS;
  }

  reset(): void {
    this.generation += 1;
    this.center = null;
    this.loading = false;
    this.cache.clear();
  }

  state(scene: SceneContext | null = null): SceneBubbleStreamState {
    return { center: this.center, scene, loading: this.loading, generation: this.generation };
  }

  shouldRefresh(location: Location): boolean {
    if (!this.center) return true;
    return distanceMeters(this.center, location) >= this.refreshDistanceMeters;
  }

  async ensure(
    location: Location,
    fetcher: (location: Location, radiusMeters: number) => Promise<SceneContext>,
  ): Promise<SceneContext | null> {
    if (!this.shouldRefresh(location)) {
      return this.cache.get(sceneCacheKey(this.center!, this.radiusMeters));
    }

    const key = sceneCacheKey(location, this.radiusMeters);
    const cached = this.cache.get(key);
    if (cached) {
      this.center = location;
      return cached;
    }

    const requestGeneration = ++this.generation;
    this.loading = true;
    try {
      const scene = await fetcher(location, this.radiusMeters);
      if (requestGeneration !== this.generation) return null;
      this.cache.set(key, scene);
      this.center = location;
      return scene;
    } finally {
      if (requestGeneration === this.generation) this.loading = false;
    }
  }

  get cacheSize(): number {
    return this.cache.size();
  }
}
