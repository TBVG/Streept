import { SceneConfidence } from './sceneConfidence';

export type DriverGuidanceFallback = 'lane' | 'junction' | 'route' | 'maneuver';

export interface DriverGuidanceFallbackPlan {
  level: DriverGuidanceFallback;
  laneAuthority: number;
  branchAuthority: number;
  continuityAuthority: number;
  reason: string;
}

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));

/**
 * Selects the strongest guidance claim the navigation stack can actually
 * support. This is renderer-neutral: it never changes routing, only which
 * physical claim is allowed to dominate the driver's view.
 */
export function buildDriverGuidanceFallback(confidence: SceneConfidence, hasLanePlan: boolean, hasPhysicalConnector: boolean): DriverGuidanceFallbackPlan {
  const laneReady = hasLanePlan && confidence.lane >= 0.72 && confidence.gps >= 0.58;
  const junctionReady = hasPhysicalConnector && confidence.topology >= 0.62 && confidence.gps >= 0.48;

  if (laneReady) {
    return { level: 'lane', laneAuthority: clamp(0.72 + confidence.lane * 0.28), branchAuthority: clamp(0.64 + confidence.topology * 0.36), continuityAuthority: 0.82, reason: 'lane match is sufficiently reliable' };
  }
  if (junctionReady) {
    return { level: 'junction', laneAuthority: 0.20, branchAuthority: clamp(0.52 + confidence.topology * 0.30), continuityAuthority: 0.70, reason: 'lane match is uncertain; physical junction topology is trusted' };
  }
  if (confidence.overall >= 0.42 && confidence.gps >= 0.34) {
    return { level: 'route', laneAuthority: 0.08, branchAuthority: 0.12, continuityAuthority: clamp(0.48 + confidence.overall * 0.30), reason: 'lane and junction claims are uncertain; route corridor is the safest physical claim' };
  }
  return { level: 'maneuver', laneAuthority: 0, branchAuthority: 0.05, continuityAuthority: 0.20, reason: 'navigation state is uncertain; avoid asserting physical lane or branch geometry' };
}
