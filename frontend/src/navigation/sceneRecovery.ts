import { SceneConfidence } from './sceneConfidence';

export type SceneRecoveryState = 'stable' | 'lane-uncertain' | 'scene-stale' | 'reacquiring';

export interface SceneRecoveryInput {
  confidence: SceneConfidence;
  sceneAgeMs: number | null;
  nowMs?: number;
}

export interface SceneRecoveryPlan {
  state: SceneRecoveryState;
  guidanceAlpha: number;
  branchAlpha: number;
  continuityAlpha: number;
  showRecoveryCue: boolean;
  message: string;
}

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));

/**
 * Turns confidence degradation into a reversible visual recovery state. It
 * never changes the route decision; it only tells the renderer how strongly
 * to present physical guidance while the driver/map state is being recovered.
 */
export function buildSceneRecoveryPlan(input: SceneRecoveryInput): SceneRecoveryPlan {
  const c = input.confidence;
  const age = input.sceneAgeMs == null ? null : Math.max(0, input.sceneAgeMs);
  const stale = age != null && age > 5 * 60 * 1000;
  const laneUncertain = c.lane < 0.52 || c.gps < 0.45;
  const weakOverall = c.overall < 0.52;

  if (stale && (weakOverall || c.scene < 0.55)) {
    return { state: 'scene-stale', guidanceAlpha: 0.42, branchAlpha: 0.18, continuityAlpha: 0.35, showRecoveryCue: true, message: 'Map detail is refreshing' };
  }
  if (laneUncertain) {
    return { state: 'lane-uncertain', guidanceAlpha: 0.48, branchAlpha: 0.24, continuityAlpha: 0.48, showRecoveryCue: true, message: 'Confirming your lane' };
  }
  if (weakOverall || c.topology < 0.48 || c.scene < 0.42) {
    return { state: 'reacquiring', guidanceAlpha: 0.58, branchAlpha: 0.32, continuityAlpha: 0.60, showRecoveryCue: true, message: 'Refreshing road guidance' };
  }
  return {
    state: 'stable',
    guidanceAlpha: clamp(0.76 + c.overall * 0.24),
    branchAlpha: clamp(0.68 + c.overall * 0.32),
    continuityAlpha: clamp(0.72 + c.overall * 0.28),
    showRecoveryCue: false,
    message: 'Guidance ready',
  };
}
