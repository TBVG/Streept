import { RoadIntelligenceAggregate } from './spatialIntelligenceApi';
import { RoadIntelligenceScore } from './roadIntelligence';

export interface CommunityRoadIntelligence extends RoadIntelligenceScore {
  source: 'local' | 'community' | 'fused';
  communityObservations: number;
  communityConfidence: number;
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }

/** Conservatively fuses private local evidence with anonymous community evidence. */
export function fuseRoadIntelligence(local: RoadIntelligenceScore, community?: RoadIntelligenceAggregate | null): CommunityRoadIntelligence {
  if (!community || community.observations <= 0 || community.confidence <= 0) {
    return { ...local, source: 'local', communityObservations: 0, communityConfidence: 0 };
  }
  const localWeight = clamp01(local.confidence);
  const communityWeight = clamp01(community.confidence);
  const total = localWeight + communityWeight;
  const score = total > 0 ? (local.score * localWeight + community.score * communityWeight) / total : community.score;
  return {
    wayId: local.wayId ?? community.way_id,
    score: Math.round(score),
    observations: local.observations + community.observations,
    completed: local.completed + community.completed,
    missed: local.missed + community.missed,
    laneMisalignments: local.laneMisalignments + community.lane_misalignments,
    hazards: local.hazards + community.hazards,
    confidence: clamp01(Math.max(localWeight, communityWeight)),
    source: local.observations > 0 ? 'fused' : 'community',
    communityObservations: community.observations,
    communityConfidence: community.confidence,
  };
}

export function indexCommunityRoadIntelligence(items: RoadIntelligenceAggregate[]): Map<number, RoadIntelligenceAggregate> {
  return new Map(items.filter((item) => Number.isFinite(item.way_id) && item.way_id > 0).map((item) => [item.way_id, item]));
}
