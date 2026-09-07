import { Location } from '../types';
import { SceneChunk } from './sceneChunks';
import { RenderQualityTier } from './adaptiveRenderQuality';

export type SceneBubbleState = 'active' | 'warming' | 'handoff' | 'retiring' | 'stale';

export interface SceneBubblePlanItem {
  key: string;
  state: SceneBubbleState;
  priority: number;
  weight: number;
  distanceMeters: number;
}

export interface SceneReacquisitionPlan {
  items: SceneBubblePlanItem[];
  desiredKeys: string[];
  renderKeys: string[];
  retireKeys: string[];
  primaryKey: string | null;
  handoffDurationMs: number;
}

const distanceMeters = (a: Location, b: Location) => {
  const latScale = 111320;
  const lngScale = latScale * Math.max(0.2, Math.cos(a.lat * Math.PI / 180));
  return Math.hypot((a.lat - b.lat) * latScale, (a.lng - b.lng) * lngScale);
};

const limits: Record<RenderQualityTier, number> = { high: 7, balanced: 5, performance: 3 };

/**
 * Plans scene-bubble handoff without coupling policy to Cesium. New forward
 * bubbles are warmed before old bubbles are retired, so crossing a chunk
 * boundary never requires a hard visual swap.
 */
export function buildSceneReacquisitionPlan(
  chunks: SceneChunk[],
  location: Location,
  previousLocation: Location | null,
  existingKeys: Set<string>,
  staleKeys: Set<string> = new Set(),
  quality: RenderQualityTier = 'high',
  preferredKeys: string[] = [],
): SceneReacquisitionPlan {
  const max = limits[quality];
  const movement = previousLocation ? distanceMeters(previousLocation, location) : 0;
  const scored = chunks.map((chunk) => {
    const d = distanceMeters(location, chunk.center);
    const exists = existingKeys.has(chunk.key);
    const stale = staleKeys.has(chunk.key);
    const state: SceneBubbleState = stale ? 'stale' : exists ? 'active' : 'warming';
    const preferredIndex = preferredKeys.indexOf(chunk.key);
    const predictiveBonus = preferredIndex >= 0 ? Math.max(0, 0.7 - preferredIndex * 0.09) : 0;
    const priority = 1 / (1 + d) + predictiveBonus;
    return { key: chunk.key, state, priority, weight: exists ? 1 : 0.35, distanceMeters: d };
  }).sort((a, b) => a.distanceMeters - b.distanceMeters);

  const desired = scored.slice(0, max);
  const desiredKeys = desired.map((item) => item.key);
  const primaryKey = desired[0]?.key ?? null;
  const forwardBonus = movement > 8 ? 0.25 : 0;

  const items: SceneBubblePlanItem[] = desired.map((item, index) => {
    const chunk = chunks.find((candidate) => candidate.key === item.key);
    const behind = Boolean(previousLocation && movement > 8 && chunk &&
      distanceMeters(previousLocation, chunk.center) + 1 < distanceMeters(location, chunk.center));
    return {
      ...item,
      priority: item.priority + Math.max(0, forwardBonus * (1 - index / Math.max(1, desired.length))),
      state: item.state === 'stale' ? 'stale' : behind ? 'handoff' : item.state === 'warming' ? 'warming' : 'active',
      weight: item.key === primaryKey ? 1 : item.weight,
    };
  });

  // Keep the nearest previous bubbles around for one handoff window. The
  // renderer owns their timestamps; this planner only declares intent.
  const renderKeys = [...new Set([...desiredKeys, ...[...existingKeys].filter((key) => !desiredKeys.includes(key)).slice(0, 2)])];
  const retireKeys = [...existingKeys].filter((key) => !desiredKeys.includes(key) && !renderKeys.includes(key));
  for (const key of renderKeys) {
    if (!desiredKeys.includes(key)) items.push({ key, state: 'handoff', priority: 0.01, weight: 0.65, distanceMeters: Number.POSITIVE_INFINITY });
  }

  return { items, desiredKeys, renderKeys, retireKeys, primaryKey, handoffDurationMs: movement > 20 ? 1100 : 1500 };
}
