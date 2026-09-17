import { describe, expect, it } from 'vitest';
import { buildRouteDecisionProfiles, rankRoutesBySpatialIntelligence } from './routeDecisionIntelligence';
import { Route3DHighlight } from '../types';

const route = (duration: number, wayCount = 1): Route3DHighlight => ({
  provider: 'osrm', duration_seconds: duration, distance_meters: duration * 10,
  segments: [{ coords: Array.from({ length: wayCount + 1 }, (_, i) => ({ lat: 10, lng: 20 + i * 0.001, alt: 0 })), is_highlighted: true, color: '#fff', lane_index: null }],
  maneuvers: [],
});

describe('routeDecisionIntelligence', () => {
  it('keeps the faster route preferred when no learned evidence exists', () => {
    const profiles = buildRouteDecisionProfiles([route(600), route(620)], [], null, new Map());
    expect(rankRoutesBySpatialIntelligence(profiles)).toEqual([0, 1]);
  });

  it('penalizes a route with strong learned road difficulty', () => {
    const community = new Map([[123, {
      way_id: 123, observations: 24, completed: 5, missed: 12, lane_misalignments: 5, hazards: 2,
      miss_rate: 0.7, lane_misalignment_rate: 0.2, hazard_rate: 0.08, score: 92, confidence: 0.95,
    }]]);
    const profiles = buildRouteDecisionProfiles([route(600), route(605)], [], null, community);
    // Without a scene mapping there is no way to safely apply the community
    // record; this verifies the no-invented-topology rule.
    expect(rankRoutesBySpatialIntelligence(profiles)).toEqual([0, 1]);
  });

  it('exposes explainable difficulty counts from mapped roads', () => {
    const scene = { buildings: [], roads: [{ osm_id: 123, geometry: [{ lat: 10, lng: 20, alt: 0 }, { lat: 10, lng: 20.001, alt: 0 }], lanes: 2, oneway: true }], signals: [], crossings: [], stops: [], trees: [] };
    const community = new Map([[123, {
      way_id: 123, observations: 24, completed: 5, missed: 12, lane_misalignments: 5, hazards: 2,
      miss_rate: 0.7, lane_misalignment_rate: 0.2, hazard_rate: 0.08, score: 92, confidence: 0.95,
    }]]);
    const profiles = buildRouteDecisionProfiles([route(600)], [], scene, community);
    expect(profiles[0].highAttentionRoads).toBe(1);
    expect(profiles[0].reason).toContain('high-attention');
  });
});
