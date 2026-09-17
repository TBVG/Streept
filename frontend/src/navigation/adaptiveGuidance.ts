import { RoadIntelligenceScore } from './roadIntelligence';
import { SpatialGuidanceDecision } from './spatialGuidanceDecision';

/** Applies learned local road difficulty without overriding hard safety facts. */
export function adaptSpatialGuidance(base: SpatialGuidanceDecision, road: RoadIntelligenceScore, maneuverDistanceMeters: number | null): SpatialGuidanceDecision {
  if (road.observations < 3 || road.confidence < 0.35 || maneuverDistanceMeters == null) return base;
  if (road.score >= 70 && maneuverDistanceMeters <= 220 && base.action === 'continue') {
    return { ...base, action: 'prepare', priority: 'elevated', confidence: Math.min(base.confidence || 1, road.confidence), reason: 'learned-road-difficulty' };
  }
  if (road.score >= 85 && maneuverDistanceMeters <= 110 && (base.action === 'continue' || base.action === 'prepare')) {
    return { ...base, action: 'high-alert', priority: 'critical', confidence: Math.min(base.confidence || 1, road.confidence), reason: 'learned-high-difficulty-road' };
  }
  return base;
}
