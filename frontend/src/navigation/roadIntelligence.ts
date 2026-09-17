import { SpatialObservation } from './observationLedger';

export interface RoadIntelligenceScore {
  wayId: number | null;
  score: number;
  observations: number;
  completed: number;
  missed: number;
  laneMisalignments: number;
  hazards: number;
  confidence: number;
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }

/**
 * Converts local coarse observations into a conservative road difficulty score.
 * Sparse observations intentionally produce low confidence and cannot make a
 * road appear difficult until enough evidence exists.
 */
export function scoreRoadIntelligence(observations: SpatialObservation[], wayId: number | null): RoadIntelligenceScore {
  if (wayId == null) return { wayId: null, score: 0, observations: 0, completed: 0, missed: 0, laneMisalignments: 0, hazards: 0, confidence: 0 };
  const relevant = observations.filter(o => o.wayId === wayId);
  const completed = relevant.filter(o => o.type === 'maneuver_completed').length;
  const missed = relevant.filter(o => o.type === 'maneuver_missed').length;
  const laneMisalignments = relevant.filter(o => o.type === 'lane_misalignment').length;
  const hazards = relevant.filter(o => o.type === 'hazard_observed').length;
  const n = relevant.length;
  if (!n) return { wayId, score: 0, observations: 0, completed, missed, laneMisalignments, hazards, confidence: 0 };

  const missRate = missed / Math.max(1, completed + missed);
  const laneRate = laneMisalignments / n;
  const hazardRate = hazards / n;
  const repeatMissBonus = Math.min(20, Math.max(0, missed - 2) * 7);
  const raw = 100 * (0.55 * missRate + 0.25 * laneRate + 0.20 * hazardRate) + repeatMissBonus;
  const confidence = clamp01(n / 8) * clamp01(relevant.reduce((sum, o) => sum + o.confidence, 0) / n);
  return { wayId, score: Math.round(raw), observations: n, completed, missed, laneMisalignments, hazards, confidence };
}
