import { RouteCoord, SceneRoad } from '../types';
import { buildLaneCenterline } from './laneGeometry';

export interface LaneChangeTrajectory {
  sourceLane: number;
  targetLane: number;
  points: RouteCoord[];
  lengthMeters: number;
  lateralShiftMeters: number;
  startFraction: number;
  endFraction: number;
  confidence: number;
  reachable: boolean;
  reason: 'physical' | 'insufficient-runway' | 'invalid-lanes' | 'same-lane';
}

function distance(a: RouteCoord, b: RouteCoord): number {
  return Math.hypot((b.lat - a.lat) * 110540, (b.lng - a.lng) * 111320 * Math.max(0.2, Math.cos(a.lat * Math.PI / 180)));
}

function cumulative(points: RouteCoord[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) out.push(out[i - 1] + distance(points[i - 1], points[i]));
  return out;
}

function sample(points: RouteCoord[], cumulativeMeters: number[], meters: number): RouteCoord {
  if (points.length < 2) return points[0];
  const total = cumulativeMeters[cumulativeMeters.length - 1];
  const target = Math.max(0, Math.min(total, meters));
  for (let i = 1; i < cumulativeMeters.length; i += 1) {
    if (cumulativeMeters[i] >= target) {
      const span = Math.max(0.001, cumulativeMeters[i] - cumulativeMeters[i - 1]);
      const t = (target - cumulativeMeters[i - 1]) / span;
      return {
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
        lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * t,
        alt: (points[i - 1].alt ?? 0) + ((points[i].alt ?? 0) - (points[i - 1].alt ?? 0)) * t,
      };
    }
  }
  return points[points.length - 1];
}

/**
 * Builds a geographic lane-change path between two physical lane centerlines.
 * The lateral movement uses a smoothstep profile: slow at entry, strongest in
 * the middle, and settled before the end. This avoids the visual "diagonal
 * jump" of a simple lane-index interpolation and gives Cesium a reusable
 * physical trajectory.
 */
export function buildLaneChangeTrajectory(
  road: SceneRoad,
  sourceLane: number,
  targetLane: number,
  runwayMeters = 48,
  minimumRunwayMeters = 28,
): LaneChangeTrajectory {
  const laneCount = Math.max(1, Math.min(8, road.lanes ?? 1));
  if (sourceLane < 0 || targetLane < 0 || sourceLane >= laneCount || targetLane >= laneCount) {
    return { sourceLane, targetLane, points: [], lengthMeters: 0, lateralShiftMeters: 0, startFraction: 0, endFraction: 0, confidence: 0, reachable: false, reason: 'invalid-lanes' };
  }
  if (sourceLane === targetLane) {
    return { sourceLane, targetLane, points: [], lengthMeters: 0, lateralShiftMeters: 0, startFraction: 0, endFraction: 0, confidence: 1, reachable: true, reason: 'same-lane' };
  }

  const source = buildLaneCenterline(road, sourceLane, laneCount);
  const target = buildLaneCenterline(road, targetLane, laneCount);
  if (!source || !target) {
    return { sourceLane, targetLane, points: [], lengthMeters: 0, lateralShiftMeters: 0, startFraction: 0, endFraction: 0, confidence: 0, reachable: false, reason: 'invalid-lanes' };
  }

  const sourceLengths = cumulative(source.points);
  const targetLengths = cumulative(target.points);
  const sourceTotal = sourceLengths[sourceLengths.length - 1];
  const targetTotal = targetLengths[targetLengths.length - 1];
  const available = Math.min(sourceTotal, targetTotal);
  const runway = Math.max(0, Math.min(runwayMeters, available));
  if (runway < minimumRunwayMeters) {
    return { sourceLane, targetLane, points: [], lengthMeters: runway, lateralShiftMeters: Math.abs(source.widthMeters * (targetLane - sourceLane)), startFraction: 0, endFraction: available ? runway / available : 0, confidence: available / Math.max(minimumRunwayMeters, runwayMeters), reachable: false, reason: 'insufficient-runway' };
  }

  const sampleCount = Math.max(10, Math.min(24, Math.ceil(runway / 3)));
  const startOffset = Math.max(0, available - runway);

  const points: RouteCoord[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const progress = i / (sampleCount - 1);
    const smooth = progress * progress * (3 - 2 * progress);
    const s = sample(source.points, sourceLengths, startOffset + runway * progress);
    const t = sample(target.points, targetLengths, startOffset + runway * progress);
    points.push({
      lat: s.lat + (t.lat - s.lat) * smooth,
      lng: s.lng + (t.lng - s.lng) * smooth,
      alt: (s.alt ?? 0) + ((t.alt ?? 0) - (s.alt ?? 0)) * smooth,
    });
  }

  const lengthMeters = cumulative(points)[cumulative(points).length - 1] ?? 0;
  const lateralShiftMeters = Math.abs(source.widthMeters * (targetLane - sourceLane));
  const laneCountPenalty = Math.max(0, Math.abs(targetLane - sourceLane) - 1) * 0.12;
  const confidence = Math.max(0.45, Math.min(0.98, 0.94 - laneCountPenalty - Math.max(0, 36 - runway) * 0.006));
  return {
    sourceLane,
    targetLane,
    points,
    lengthMeters,
    lateralShiftMeters,
    startFraction: available ? startOffset / available : 0,
    endFraction: available ? 1 : 0,
    confidence,
    reachable: true,
    reason: 'physical',
  };
}
