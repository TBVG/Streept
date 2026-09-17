import { SpatialObservation } from './observationLedger';
import { predictOnDevice } from './onDevicePredictor';
import { RoadIntelligenceAggregate, RoadIntelligenceTemporalBucket } from './spatialIntelligenceApi';

export type SpatialMemorySignal = 'stable' | 'emerging' | 'recurring' | 'elevated';

export interface TemporalBucket {
  hour: number;
  weekday: number;
  observations: number;
  difficulty: number;
  confidence: number;
}

export interface SpatialMemoryPrediction {
  wayId: number | null;
  currentScore: number;
  predictedScore: number;
  confidence: number;
  signal: SpatialMemorySignal;
  sampleCount: number;
  recentSampleCount: number;
  matchingTimeSampleCount: number;
  peakHour: number | null;
  peakWeekday: number | null;
  trend: 'improving' | 'stable' | 'worsening';
  reasons: string[];
}

export interface SpatialMemorySnapshot {
  current: SpatialMemoryPrediction;
  routePredictions: SpatialMemoryPrediction[];
  routeRisk: number;
  routeConfidence: number;
  difficultAhead: number;
}

const DAY_MS = 86_400_000;
const RECENT_MS = 3 * DAY_MS;
const HORIZON_MS = 30 * DAY_MS;

function clamp01(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function clamp100(value: number): number { return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)); }
function observationDifficulty(item: SpatialObservation): number {
  if (item.type === 'maneuver_missed') return 100;
  if (item.type === 'lane_misalignment') return 72;
  if (item.type === 'hazard_observed') return 82;
  return 0;
}
function weightedMean(items: Array<{ value: number; weight: number }>): number {
  const weight = items.reduce((sum, item) => sum + item.weight, 0);
  return weight ? items.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : 0;
}
function decay(ageMs: number): number { return Math.exp(-Math.max(0, ageMs) / (14 * DAY_MS)); }
function temporalKey(date: Date): string { return `${date.getUTCDay()}:${date.getUTCHours()}`; }

function localRoadScore(observations: SpatialObservation[], wayId: number | null, now: number): { score: number; confidence: number; count: number } {
  if (wayId == null) return { score: 0, confidence: 0, count: 0 };
  const relevant = observations.filter((item) => item.wayId === wayId && now - item.at >= -10 * 60_000 && now - item.at <= HORIZON_MS);
  const scored = relevant.map((item) => ({ value: observationDifficulty(item), weight: clamp01(item.confidence) * decay(now - item.at) }));
  const score = weightedMean(scored);
  const confidence = clamp01((relevant.length / 8) * (relevant.reduce((sum, item) => sum + clamp01(item.confidence), 0) / Math.max(1, relevant.length)));
  return { score, confidence, count: relevant.length };
}

function temporalStats(observations: SpatialObservation[], wayId: number | null, now: number): { matching: number; peakHour: number | null; peakWeekday: number | null; buckets: TemporalBucket[] } {
  if (wayId == null) return { matching: 0, peakHour: null, peakWeekday: null, buckets: [] };
  const relevant = observations.filter((item) => item.wayId === wayId && now - item.at <= HORIZON_MS && now - item.at >= -10 * 60_000);
  const current = new Date(now);
  const key = temporalKey(current);
  const groups = new Map<string, SpatialObservation[]>();
  for (const item of relevant) {
    const date = new Date(item.at);
    const k = temporalKey(date);
    const list = groups.get(k) ?? [];
    list.push(item);
    groups.set(k, list);
  }
  const buckets: TemporalBucket[] = Array.from(groups.entries()).map(([k, items]) => {
    const [weekdayText, hourText] = k.split(':');
    const difficulty = weightedMean(items.map((item) => ({ value: observationDifficulty(item), weight: clamp01(item.confidence) * decay(now - item.at) })));
    return { weekday: Number(weekdayText), hour: Number(hourText), observations: items.length, difficulty, confidence: clamp01(items.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, items.length)) };
  });
  const matchingItems = groups.get(key) ?? [];
  const hourScores = new Map<number, number>();
  const dayScores = new Map<number, number>();
  for (const bucket of buckets) {
    hourScores.set(bucket.hour, (hourScores.get(bucket.hour) ?? 0) + bucket.difficulty * bucket.observations);
    dayScores.set(bucket.weekday, (dayScores.get(bucket.weekday) ?? 0) + bucket.difficulty * bucket.observations);
  }
  const peak = (map: Map<number, number>): number | null => map.size ? [...map.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
  return { matching: matchingItems.length, peakHour: peak(hourScores), peakWeekday: peak(dayScores), buckets };
}

/**
 * Predictive spatial memory intentionally uses a small, deterministic model.
 * It is a memory layer, not an ML black box: recent observations, repeated
 * time-of-week evidence, and the current community baseline are combined with
 * explicit confidence bounds. Unknown conditions remain low-confidence.
 */
export function predictSpatialMemory(
  observations: SpatialObservation[],
  wayId: number | null,
  community: RoadIntelligenceAggregate | null | undefined,
  now = Date.now(),
  communityTemporal: RoadIntelligenceTemporalBucket[] = [],
): SpatialMemoryPrediction {
  const local = localRoadScore(observations, wayId, now);
  const temporal = temporalStats(observations, wayId, now);
  const recent = observations.filter((item) => item.wayId === wayId && now - item.at <= RECENT_MS && now - item.at >= -10 * 60_000);
  const matching = temporal.buckets.find((bucket) => bucket.hour === new Date(now).getUTCHours() && bucket.weekday === new Date(now).getUTCDay());
  const communityMatching = communityTemporal.find((bucket) => bucket.way_id === wayId && bucket.hour === new Date(now).getUTCHours() && bucket.weekday === new Date(now).getUTCDay());
  const communityScore = community && community.observations > 0 ? clamp100(community.score) : 0;
  const communityConfidence = community ? clamp01(community.confidence) : 0;
  const currentScore = local.confidence > 0 ? (local.score * local.confidence + communityScore * communityConfidence) / Math.max(0.0001, local.confidence + communityConfidence) : communityScore;
  const matchingSignal = communityMatching && communityMatching.observations >= 2
    ? (matching && matching.observations >= 2 ? (matching.difficulty * 0.55 + communityMatching.score * 0.45) : communityMatching.score)
    : (matching && matching.observations >= 2 ? matching.difficulty : currentScore);
  const recentScore = recent.length ? weightedMean(recent.map((item) => ({ value: observationDifficulty(item), weight: clamp01(item.confidence) * decay(now - item.at) }))) : currentScore;
  const deviceModel = predictOnDevice(observations, wayId, now);
  const predictedScore = clamp100(currentScore * 0.40 + recentScore * 0.27 + matchingSignal * 0.23 + deviceModel.score * 0.10);
  const temporalConfidence = communityMatching ? communityMatching.confidence * Math.min(1, communityMatching.observations / 5) : 0;
  const confidence = clamp01(Math.max(local.confidence * 0.9, communityConfidence * 0.8, matching ? matching.confidence * Math.min(1, matching.observations / 5) : 0, temporalConfidence));
  const trend = recent.length >= 2 && recentScore > currentScore + 8 ? 'worsening' : recent.length >= 2 && recentScore < currentScore - 8 ? 'improving' : 'stable';
  const signal: SpatialMemorySignal = predictedScore >= 80 && confidence >= 0.6 ? 'elevated' : predictedScore >= 60 && confidence >= 0.45 ? 'recurring' : predictedScore >= 40 && confidence >= 0.3 ? 'emerging' : 'stable';
  const reasons: string[] = [];
  if (recent.length >= 2) reasons.push(`${recent.length} recent observations`);
  if (temporal.matching >= 2) reasons.push('repeated at this time of week');
  if (communityConfidence >= 0.45) reasons.push('community baseline agrees');
  if (communityMatching && communityMatching.observations >= 2) reasons.push('community pattern matches this time');
  if (trend === 'worsening') reasons.push('recent difficulty is increasing');
  if (deviceModel.samples >= 3 && deviceModel.confidence >= 0.25) reasons.push('on-device learned signal');
  if (!reasons.length && confidence > 0) reasons.push('limited learned evidence');
  return {
    wayId, currentScore: Math.round(currentScore), predictedScore: Math.round(predictedScore), confidence,
    signal, sampleCount: local.count + (community?.observations ?? 0), recentSampleCount: recent.length,
    matchingTimeSampleCount: temporal.matching, peakHour: temporal.peakHour, peakWeekday: temporal.peakWeekday,
    trend, reasons,
  };
}

export function buildSpatialMemorySnapshot(
  wayIds: number[],
  observations: SpatialObservation[],
  community: Map<number, RoadIntelligenceAggregate>,
  currentWayId: number | null,
  now = Date.now(),
  communityTemporal: RoadIntelligenceTemporalBucket[] = [],
): SpatialMemorySnapshot {
  const unique = Array.from(new Set(wayIds.filter((id) => Number.isFinite(id) && id > 0)));
  const routePredictions = unique.map((wayId) => predictSpatialMemory(observations, wayId, community.get(wayId), now, communityTemporal));
  const current = predictSpatialMemory(observations, currentWayId, currentWayId == null ? null : community.get(currentWayId), now, communityTemporal);
  const weighted = routePredictions.filter((item) => item.confidence > 0);
  const routeRisk = weightedMean(weighted.map((item) => ({ value: item.predictedScore, weight: Math.max(0.05, item.confidence) })));
  const routeConfidence = clamp01(weighted.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, unique.length));
  return { current, routePredictions, routeRisk: Math.round(routeRisk), routeConfidence, difficultAhead: routePredictions.filter((item) => item.signal === 'recurring' || item.signal === 'elevated').length };
}
