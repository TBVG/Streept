import { SpatialIntelligenceSnapshot } from './spatialIntelligence';

export type SpatialGuidanceAction = 'continue' | 'prepare' | 'slow' | 'high-alert' | 'uncertain';

export interface SpatialGuidanceDecision {
  action: SpatialGuidanceAction;
  confidence: number;
  priority: 'normal' | 'elevated' | 'critical';
  reason: string;
  targetSpeedMps: number | null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function speedLimitMps(kph: number | null): number | null {
  return kph != null && Number.isFinite(kph) && kph > 0 ? kph / 3.6 : null;
}

/**
 * Converts the spatial snapshot into a conservative driver-facing priority.
 * This is policy, not routing: it never invents a speed limit or road fact.
 */
export function decideSpatialGuidance(snapshot: SpatialIntelligenceSnapshot, currentSpeedMps: number | null = null): SpatialGuidanceDecision {
  const confidence = clamp01(snapshot.confidence);
  const hazard = snapshot.hazardIntelligence ?? { level: 'none' as const, nearbyCriticalReports: 0, nearbyTrafficJams: 0, nearbyClosedLanes: 0, confidence: 0 };
  const lane = snapshot.laneIntelligence ?? { currentLaneIndex: null, recommendedLaneIndices: [], laneAlignment: 'unknown' as const, laneChangeDirection: 'unknown' as const, requiredLaneChanges: 0, confidence: 0 };

  // A directly observed critical road report is actionable even when the
  // broader scene match is weak. Never let missing scene geometry erase a
  // known closure/accident/hazard.
  if (hazard.level === 'critical') {
    return { action: 'high-alert', confidence: hazard.confidence, priority: 'critical', reason: hazard.nearbyClosedLanes > 0 ? 'closed-lane-nearby' : 'road-hazard-nearby', targetSpeedMps: null };
  }

  if (confidence < 0.35) {
    return { action: 'uncertain', confidence, priority: 'elevated', reason: 'limited-spatial-confidence', targetSpeedMps: null };
  }

  const distance = snapshot.maneuverDistanceMeters;
  const maneuver = snapshot.maneuver;
  const complex = maneuver === 'complex' || maneuver === 'roundabout' || maneuver === 'fork' || maneuver === 'ramp';
  const imminent = distance != null && distance <= (complex ? 180 : 120);
  const veryImminent = distance != null && distance <= (complex ? 80 : 55);
  const limit = speedLimitMps(snapshot.speedLimitKph);
  const speedTooHigh = currentSpeedMps != null && limit != null && currentSpeedMps > limit * 1.08;
  if (speedTooHigh) {
    return { action: 'slow', confidence, priority: 'elevated', reason: 'above-known-speed-limit', targetSpeedMps: limit };
  }
  if (veryImminent && complex) {
    return { action: 'high-alert', confidence, priority: 'critical', reason: 'complex-maneuver-ahead', targetSpeedMps: limit != null ? Math.min(limit, 12) : null };
  }
  if (imminent && maneuver !== 'none') {
    return { action: 'prepare', confidence, priority: 'elevated', reason: 'maneuver-ahead', targetSpeedMps: null };
  }
  if (hazard.level === 'elevated') {
    return { action: 'prepare', confidence: Math.min(confidence, hazard.confidence || confidence), priority: 'elevated', reason: 'traffic-hazard-nearby', targetSpeedMps: null };
  }
  if (lane.laneAlignment === 'misaligned' && lane.requiredLaneChanges > 0) {
    return { action: 'prepare', confidence: Math.min(confidence, lane.confidence), priority: 'elevated', reason: 'recommended-lane-change', targetSpeedMps: null };
  }
  if (snapshot.nearbySignals > 0 || snapshot.nearbyCrossings > 0) {
    return { action: 'prepare', confidence, priority: 'elevated', reason: 'nearby-road-user-control', targetSpeedMps: null };
  }
  return { action: 'continue', confidence, priority: 'normal', reason: 'no-immediate-spatial-hazard', targetSpeedMps: null };
}
