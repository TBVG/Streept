import { Maneuver } from '../types';

export type ManeuverExperience = 'standard' | 'prepare' | 'immersive';

export interface ExperienceDecision {
  phase: ManeuverExperience;
  triggerDistanceMeters: number;
  preloadDistanceMeters: number;
  importance: number;
}

const COMPLEXITY_WEIGHT: Record<string, number> = {
  roundabout: 1.0,
  rotary: 1.0,
  fork: 0.95,
  'on ramp': 0.9,
  'off ramp': 0.9,
  merge: 0.85,
  'end of road': 0.8,
  turn: 0.55,
};

function laneFactor(maneuver: Maneuver): number {
  const lanes = maneuver.lanes ?? [];
  if (!lanes.length) return 0;
  const valid = lanes.filter((lane) => lane.valid).length;
  return Math.min(1, 0.3 + valid / Math.max(1, lanes.length));
}

export function scoreManeuverImportance(maneuver: Maneuver): number {
  const base = COMPLEXITY_WEIGHT[maneuver.type] ?? (maneuver.is_complex ? 0.65 : 0.25);
  const sharpness = maneuver.modifier?.includes('sharp') ? 0.2 : maneuver.modifier?.includes('slight') ? 0.05 : 0;
  const lanes = laneFactor(maneuver) * 0.2;
  return Math.max(0, Math.min(1, base + sharpness + lanes));
}

/**
 * Converts vehicle speed + maneuver complexity into one stable experience
 * decision used by UI, scene preloading, and future native clients.
 */
export function decideManeuverExperience(maneuver: Maneuver, speedMps: number, remainingMeters: number): ExperienceDecision {
  const importance = scoreManeuverImportance(maneuver);
  const speedLead = Math.max(6, Math.min(16, speedMps * (importance > 0.75 ? 9 : 7)));
  const triggerDistanceMeters = Math.max(120, Math.min(850, 100 + speedLead * 10 + importance * 160));
  const preloadDistanceMeters = Math.max(triggerDistanceMeters + 120, 420 + importance * 280 + Math.max(0, speedMps - 10) * 8);
  let phase: ManeuverExperience = 'standard';
  if (remainingMeters <= triggerDistanceMeters) phase = importance >= 0.55 ? 'immersive' : 'prepare';
  else if (remainingMeters <= preloadDistanceMeters) phase = 'prepare';
  return { phase, triggerDistanceMeters, preloadDistanceMeters, importance };
}
