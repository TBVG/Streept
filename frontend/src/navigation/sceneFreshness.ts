export type SceneFreshnessState = 'fresh' | 'aging' | 'stale' | 'unknown';

export interface SceneFreshnessPlan {
  state: SceneFreshnessState;
  ageMs: number | null;
  ageRatio: number;
  detailScale: number;
  worldAlpha: number;
  trafficAlpha: number;
  infrastructureAlpha: number;
  billboardAlpha: number;
  keepRouteContinuity: boolean;
  message: string;
}

export interface SceneFreshnessInput {
  fetchedAtMs: number | null;
  nowMs?: number;
  agingAfterMs?: number;
  staleAfterMs?: number;
}

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));

/**
 * Deterministic scene-age policy. Freshness affects presentation only: route
 * continuity is retained even when world context becomes stale.
 */
export function buildSceneFreshnessPlan(input: SceneFreshnessInput): SceneFreshnessPlan {
  const now = input.nowMs ?? Date.now();
  const agingAfter = Math.max(1, input.agingAfterMs ?? 2 * 60 * 1000);
  const staleAfter = Math.max(agingAfter + 1, input.staleAfterMs ?? 5 * 60 * 1000);
  if (input.fetchedAtMs == null) {
    return { state: 'unknown', ageMs: null, ageRatio: 1, detailScale: 0.78, worldAlpha: 0.52, trafficAlpha: 0.52, infrastructureAlpha: 0.54, billboardAlpha: 0.46, keepRouteContinuity: true, message: 'Map detail is being acquired' };
  }
  const ageMs = Math.max(0, now - input.fetchedAtMs);
  const ratio = clamp(ageMs / staleAfter);
  if (ageMs >= staleAfter) {
    return { state: 'stale', ageMs, ageRatio: ratio, detailScale: 0.56, worldAlpha: 0.40, trafficAlpha: 0.38, infrastructureAlpha: 0.42, billboardAlpha: 0.34, keepRouteContinuity: true, message: 'Map detail is refreshing' };
  }
  if (ageMs >= agingAfter) {
    const t = clamp((ageMs - agingAfter) / (staleAfter - agingAfter));
    return { state: 'aging', ageMs, ageRatio: ratio, detailScale: lerp(0.82, 0.60, t), worldAlpha: lerp(0.72, 0.46, t), trafficAlpha: lerp(0.68, 0.42, t), infrastructureAlpha: lerp(0.68, 0.48, t), billboardAlpha: lerp(0.58, 0.38, t), keepRouteContinuity: true, message: 'Map detail is aging' };
  }
  return { state: 'fresh', ageMs, ageRatio: ratio, detailScale: 1, worldAlpha: 0.84, trafficAlpha: 0.80, infrastructureAlpha: 0.78, billboardAlpha: 0.68, keepRouteContinuity: true, message: 'Map detail is fresh' };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class SceneFreshnessTracker {
  private readonly fetchedAt = new Map<string, number>();

  markFetched(key: string, nowMs = Date.now()) { this.fetchedAt.set(key, nowMs); }
  markIfMissing(key: string, nowMs = Date.now()) { if (!this.fetchedAt.has(key)) this.fetchedAt.set(key, nowMs); }
  getFetchedAt(key: string) { return this.fetchedAt.get(key) ?? null; }
  getPlan(key: string, nowMs = Date.now()) { return buildSceneFreshnessPlan({ fetchedAtMs: this.getFetchedAt(key), nowMs }); }
  clear(key: string) { this.fetchedAt.delete(key); }
  clearAll() { this.fetchedAt.clear(); }
}
