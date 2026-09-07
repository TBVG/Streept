import { SceneRoad } from '../types';

export interface LaneContinuityResult {
  laneIndex: number;
  confidence: number;
  reason: 'same-way' | 'direct' | 'merge' | 'split' | 'fallback';
}

function laneCount(road: SceneRoad | null | undefined): number {
  return Math.max(1, Math.min(8, road?.lanes ?? 1));
}

/** Map a lane identity across an OSM way boundary. This is intentionally
 * conservative: equal lane counts preserve identity; merges collapse toward
 * the nearest surviving lane; splits preserve the source lane and allow an
 * adjacent branch without pretending the new lane existed upstream. */
export function mapLaneAcrossWays(
  previousLane: number | null,
  fromRoad: SceneRoad | null,
  toRoad: SceneRoad | null,
): LaneContinuityResult | null {
  if (previousLane == null || !toRoad) return null;
  const fromCount = laneCount(fromRoad);
  const toCount = laneCount(toRoad);
  const source = Math.max(0, Math.min(fromCount - 1, previousLane));

  if (fromRoad?.oneway_reverse !== toRoad.oneway_reverse) {
    return { laneIndex: Math.max(0, Math.min(toCount - 1, toCount - 1 - source)), confidence: 0.55, reason: 'fallback' };
  }
  if (fromCount === toCount) return { laneIndex: source, confidence: 0.92, reason: 'direct' };
  if (toCount < fromCount) {
    const mapped = Math.min(toCount - 1, source);
    return { laneIndex: mapped, confidence: source < toCount ? 0.78 : 0.64, reason: 'merge' };
  }
  const mapped = Math.min(toCount - 1, source);
  return { laneIndex: mapped, confidence: 0.72, reason: 'split' };
}

export function laneContinuityPenalty(
  observedLane: number | null,
  carriedLane: number | null,
  confidence: number,
): number {
  if (observedLane == null || carriedLane == null) return 0;
  const delta = Math.abs(observedLane - carriedLane);
  if (!delta) return 0;
  return delta === 1 && confidence < 0.65 ? 0.18 : Math.min(0.65, delta * 0.28);
}
