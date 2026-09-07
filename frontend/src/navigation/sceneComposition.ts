import { SceneConfidence } from './sceneConfidence';
import { SceneRecoveryPlan } from './sceneRecovery';
import { DriverGuidanceFallbackPlan } from './driverGuidanceFallback';

export type SceneCompositionLayer = 'authoritative' | 'supportive' | 'uncertain';

export interface SceneCompositionPlan {
  layer: Record<string, SceneCompositionLayer>;
  guidanceAlpha: number;
  branchAlpha: number;
  continuityAlpha: number;
  worldAlpha: number;
  trafficAlpha: number;
  infrastructureAlpha: number;
  billboardAlpha: number;
  recoveryAlpha: number;
  maxWorldDetail: number;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

/**
 * Converts navigation confidence/recovery state into one deterministic visual
 * composition policy. It never changes routing or lane decisions; it decides
 * which visual layers are allowed to dominate the driver's attention.
 */
export function buildSceneComposition(
  confidence: SceneConfidence,
  recovery: SceneRecoveryPlan,
  fallback: DriverGuidanceFallbackPlan,
): SceneCompositionPlan {
  const stable = recovery.state === 'stable';
  const sceneTrust = clamp(confidence.scene * (stable ? 1 : 0.82));
  const guidanceTrust = clamp(confidence.guidanceAlpha * recovery.guidanceAlpha * Math.max(0.25, fallback.continuityAuthority));
  const worldAlpha = clamp(0.34 + sceneTrust * 0.52, 0.30, stable ? 0.88 : 0.66);
  const trafficAlpha = clamp(0.34 + confidence.overall * 0.46, 0.30, stable ? 0.82 : 0.60);
  const infrastructureAlpha = clamp(0.38 + sceneTrust * 0.42, 0.34, stable ? 0.78 : 0.60);
  const billboardAlpha = clamp(0.28 + sceneTrust * 0.36, 0.24, stable ? 0.68 : 0.52);

  const authoritative: SceneCompositionLayer = fallback.level === 'lane' ? 'authoritative' : 'supportive';
  const branch: SceneCompositionLayer = fallback.level === 'lane' || fallback.level === 'junction' ? 'authoritative' : 'supportive';
  const uncertainWorld = confidence.scene < 0.55 || recovery.state === 'scene-stale' || recovery.state === 'reacquiring';

  return {
    layer: {
      'driver-lane': authoritative,
      'junction-branch': branch,
      'route-continuity': fallback.level === 'maneuver' ? 'supportive' : 'authoritative',
      'osm-world': uncertainWorld ? 'uncertain' : 'supportive',
      traffic: confidence.overall < 0.50 ? 'uncertain' : 'supportive',
      infrastructure: uncertainWorld ? 'uncertain' : 'supportive',
      billboard: 'supportive',
      recovery: recovery.showRecoveryCue ? 'authoritative' : 'supportive',
    },
    guidanceAlpha: clamp(0.58 + guidanceTrust * 0.42),
    branchAlpha: clamp(recovery.branchAlpha * (0.62 + confidence.topology * 0.38)),
    continuityAlpha: clamp(recovery.continuityAlpha * (0.68 + confidence.overall * 0.32)),
    worldAlpha,
    trafficAlpha,
    infrastructureAlpha,
    billboardAlpha,
    recoveryAlpha: recovery.showRecoveryCue ? clamp(0.35 + (1 - confidence.overall) * 0.35) : 0,
    maxWorldDetail: uncertainWorld ? 0.72 : 1,
  };
}
