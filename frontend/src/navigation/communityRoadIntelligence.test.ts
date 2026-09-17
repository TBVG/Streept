import { describe, expect, it } from 'vitest';
import { fuseRoadIntelligence, indexCommunityRoadIntelligence } from './communityRoadIntelligence';
import { RoadIntelligenceScore } from './roadIntelligence';

const local: RoadIntelligenceScore = { wayId: 42, score: 20, observations: 4, completed: 4, missed: 0, laneMisalignments: 0, hazards: 0, confidence: 0.5 };
const community = { way_id: 42, observations: 20, completed: 10, missed: 10, lane_misalignments: 2, hazards: 1, miss_rate: .5, lane_misalignment_rate: .1, hazard_rate: .05, score: 65, confidence: .8 };

describe('community road intelligence', () => {
  it('fuses local and community evidence by confidence', () => {
    const result = fuseRoadIntelligence(local, community);
    expect(result.source).toBe('fused');
    expect(result.score).toBeGreaterThan(20);
    expect(result.score).toBeLessThan(65);
    expect(result.communityObservations).toBe(20);
  });
  it('indexes aggregates by way id', () => {
    expect(indexCommunityRoadIntelligence([community]).get(42)?.score).toBe(65);
  });
});
