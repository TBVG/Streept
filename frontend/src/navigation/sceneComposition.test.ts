import { buildSceneComposition } from './sceneComposition';
import { SceneConfidence } from './sceneConfidence';
import { SceneRecoveryPlan } from './sceneRecovery';
import { DriverGuidanceFallbackPlan } from './driverGuidanceFallback';

const confidence = (overrides: Partial<SceneConfidence> = {}): SceneConfidence => ({ overall: 0.9, lane: 0.9, topology: 0.9, gps: 0.9, scene: 0.9, guidanceAlpha: 0.9, branchAlpha: 0.9, ...overrides });
const recovery = (overrides: Partial<SceneRecoveryPlan> = {}): SceneRecoveryPlan => ({ state: 'stable', guidanceAlpha: 0.9, branchAlpha: 0.9, continuityAlpha: 0.9, showRecoveryCue: false, message: 'Guidance ready', ...overrides });
const fallback = (overrides: Partial<DriverGuidanceFallbackPlan> = {}): DriverGuidanceFallbackPlan => ({ level: 'lane', laneAuthority: 0.9, branchAuthority: 0.9, continuityAuthority: 0.9, reason: 'trusted', ...overrides });

describe('buildSceneComposition', () => {
  it('keeps the trusted world readable and guidance dominant', () => {
    const plan = buildSceneComposition(confidence(), recovery(), fallback());
    expect(plan.layer['driver-lane']).toBe('authoritative');
    expect(plan.worldAlpha).toBeGreaterThan(0.7);
    expect(plan.guidanceAlpha).toBeGreaterThan(plan.worldAlpha);
    expect(plan.recoveryAlpha).toBe(0);
  });

  it('subordinates world context when GPS/scene confidence degrades', () => {
    const plan = buildSceneComposition(confidence({ overall: 0.36, gps: 0.28, scene: 0.32, topology: 0.35, guidanceAlpha: 0.66 }), recovery({ state: 'reacquiring', guidanceAlpha: 0.58, branchAlpha: 0.32, continuityAlpha: 0.60, showRecoveryCue: true }), fallback({ level: 'route', laneAuthority: 0.08, branchAuthority: 0.12, continuityAuthority: 0.58 }));
    expect(plan.layer['osm-world']).toBe('uncertain');
    expect(plan.worldAlpha).toBeLessThan(0.67);
    expect(plan.recoveryAlpha).toBeGreaterThan(0);
    expect(plan.continuityAlpha).toBeGreaterThan(0.25);
  });

  it('treats stale scene detail as supportive context rather than authority', () => {
    const plan = buildSceneComposition(confidence({ scene: 0.48 }), recovery({ state: 'scene-stale', guidanceAlpha: 0.42, branchAlpha: 0.18, continuityAlpha: 0.35, showRecoveryCue: true }), fallback({ level: 'route', laneAuthority: 0.08, branchAuthority: 0.12, continuityAuthority: 0.60 }));
    expect(plan.layer['osm-world']).toBe('uncertain');
    expect(plan.maxWorldDetail).toBeLessThan(1);
    expect(plan.continuityAlpha).toBeGreaterThan(0);
  });
});
