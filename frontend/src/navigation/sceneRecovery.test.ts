import { buildSceneRecoveryPlan } from './sceneRecovery';

const confidence = (overrides: Partial<any> = {}) => ({
  overall: 0.9, lane: 0.92, topology: 0.9, gps: 0.9, scene: 0.9, guidanceAlpha: 0.9, branchAlpha: 0.8, ...overrides,
});

describe('buildSceneRecoveryPlan', () => {
  it('keeps strong guidance stable', () => {
    const plan = buildSceneRecoveryPlan({ confidence: confidence(), sceneAgeMs: 30_000 });
    expect(plan.state).toBe('stable');
    expect(plan.showRecoveryCue).toBe(false);
  });

  it('distinguishes stale scene data from lane uncertainty', () => {
    expect(buildSceneRecoveryPlan({ confidence: confidence({ scene: 0.35, overall: 0.48 }), sceneAgeMs: 8 * 60_000 }).state).toBe('scene-stale');
    expect(buildSceneRecoveryPlan({ confidence: confidence({ lane: 0.3, gps: 0.4 }), sceneAgeMs: 30_000 }).state).toBe('lane-uncertain');
  });

  it('recovers without removing guidance entirely', () => {
    const plan = buildSceneRecoveryPlan({ confidence: confidence({ overall: 0.45, topology: 0.4 }), sceneAgeMs: null });
    expect(plan.state).toBe('reacquiring');
    expect(plan.guidanceAlpha).toBeGreaterThan(0);
    expect(plan.continuityAlpha).toBeGreaterThan(0);
  });
});
