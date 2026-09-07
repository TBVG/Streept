import { Location } from '../types';
import { RenderQualityTier } from './adaptiveRenderQuality';
import { SceneChunk } from './sceneChunks';

export type SceneResidencyState = 'active' | 'warm' | 'handoff' | 'retiring' | 'cold';

export interface SceneResidencyItem {
  key: string;
  state: SceneResidencyState;
  score: number;
  lastUsed: number;
  protected: boolean;
}

export interface SceneResidencyPlan {
  keepKeys: string[];
  evictKeys: string[];
  items: SceneResidencyItem[];
  maxResident: number;
}

const limits: Record<RenderQualityTier, number> = { high: 7, balanced: 5, performance: 3 };

const distanceMeters = (a: Location, b: Location) => {
  const latScale = 111320;
  const lngScale = latScale * Math.max(0.2, Math.cos(a.lat * Math.PI / 180));
  return Math.hypot((a.lat - b.lat) * latScale, (a.lng - b.lng) * lngScale);
};

/**
 * Keeps the Cesium scene bounded over long drives. This is deliberately
 * framework-neutral: the renderer owns actual primitive/entity disposal.
 */
export function buildSceneResidencyPlan(
  chunks: SceneChunk[],
  location: Location,
  existingKeys: Set<string>,
  preferredKeys: string[] = [],
  protectedKeys: string[] = [],
  lastUsed: Map<string, number> = new Map(),
  quality: RenderQualityTier = 'high',
  now = Date.now(),
): SceneResidencyPlan {
  const maxResident = limits[quality];
  const preferred = new Map(preferredKeys.map((key, index) => [key, index]));
  const protectedSet = new Set(protectedKeys);
  const candidates: SceneResidencyItem[] = chunks.map((chunk) => {
    const distance = distanceMeters(location, chunk.center);
    const exists = existingKeys.has(chunk.key);
    const preference = preferred.has(chunk.key) ? Math.max(0, 1 - (preferred.get(chunk.key)! / Math.max(1, preferredKeys.length))) : 0;
    const ageMs = Math.max(0, now - (lastUsed.get(chunk.key) ?? now));
    const recency = Math.max(0, 1 - Math.min(1, ageMs / 120000));
    const forward = preference * 0.9;
    const proximity = 1 / (1 + distance / 180);
    const score = (protectedSet.has(chunk.key) ? 10 : 0) + forward + proximity + (exists ? recency * 0.45 : 0);
    const state: SceneResidencyState = protectedSet.has(chunk.key) ? 'active' : exists ? 'warm' : 'cold';
    return { key: chunk.key, state, score, lastUsed: lastUsed.get(chunk.key) ?? 0, protected: protectedSet.has(chunk.key) };
  });

  // Existing chunks that are no longer in the latest scene are eviction
  // candidates, but are retained only when they fit the bounded handoff set.
  for (const key of existingKeys) {
    if (candidates.some((item) => item.key === key)) continue;
    const ageMs = Math.max(0, now - (lastUsed.get(key) ?? 0));
    candidates.push({ key, state: 'retiring', score: Math.max(0, 0.15 - ageMs / 1000000), lastUsed: lastUsed.get(key) ?? 0, protected: protectedSet.has(key) });
  }

  const ranked = candidates.sort((a, b) => b.score - a.score || b.lastUsed - a.lastUsed || a.key.localeCompare(b.key));
  // A chunk that disappeared from the latest delivery bubble is retiring, not
  // a candidate for fresh residency. Keeping it merely because it is old-but-
  // existing can consume the entire budget and leave genuinely relevant chunks
  // out of the renderer.
  const residentCandidates = ranked.filter((item) => item.state !== 'retiring');
  const keep = residentCandidates.slice(0, maxResident);
  // Never evict protected keys. If a protected set exceeds the quality budget,
  // keep all protected keys rather than violating the driver's current view.
  for (const item of ranked) {
    if (!item.protected || keep.some((kept) => kept.key === item.key)) continue;
    keep.push(item);
  }
  const keepKeys = [...new Set(keep.map((item) => item.key))];
  const evictKeys = [...existingKeys].filter((key) => !keepKeys.includes(key));
  return { keepKeys, evictKeys, items: ranked, maxResident };
}

export { sceneObjectIdentity } from './sceneObjectIdentity';

export class SceneResidencyManager {
  private readonly lastUsed = new Map<string, number>();

  touch(keys: Iterable<string>, now = Date.now()): void {
    for (const key of keys) this.lastUsed.set(key, now);
  }

  plan(chunks: SceneChunk[], location: Location, existingKeys: Set<string>, preferredKeys: string[], protectedKeys: string[], quality: RenderQualityTier, now = Date.now()): SceneResidencyPlan {
    const plan = buildSceneResidencyPlan(chunks, location, existingKeys, preferredKeys, protectedKeys, this.lastUsed, quality, now);
    this.touch(plan.keepKeys, now);
    for (const key of plan.evictKeys) this.lastUsed.delete(key);
    return plan;
  }

  clear(): void { this.lastUsed.clear(); }
}
