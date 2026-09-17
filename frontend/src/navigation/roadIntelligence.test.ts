import { describe, expect, it } from 'vitest';
import { scoreRoadIntelligence } from './roadIntelligence';
import { SpatialObservation } from './observationLedger';

const obs = (type: SpatialObservation['type'], confidence = 1): SpatialObservation => ({ id: Math.random().toString(), at: 1, type, routeGeneration: 1, maneuverKey: null, wayId: 42, maneuver: 'turn', laneAlignment: 'unknown', confidence });

describe('road intelligence', () => {
  it('requires enough evidence before producing a useful confidence', () => {
    const score = scoreRoadIntelligence([obs('maneuver_missed')], 42);
    expect(score.score).toBeGreaterThan(0);
    expect(score.confidence).toBeLessThan(0.35);
  });
  it('weights repeated missed maneuvers as difficult', () => {
    const observations = [obs('maneuver_missed'), obs('maneuver_missed'), obs('maneuver_missed'), obs('maneuver_completed'), obs('lane_misalignment'), obs('hazard_observed'), obs('maneuver_missed'), obs('maneuver_missed')];
    const score = scoreRoadIntelligence(observations, 42);
    expect(score.score).toBeGreaterThanOrEqual(70);
    expect(score.confidence).toBeGreaterThan(0.35);
  });
});
