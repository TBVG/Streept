import { createNavigationScenarioSuite, runNavigationScenarioSuite } from './multiScenarioSimulation';

describe('multi-scenario navigation simulation', () => {
  it('passes clean, degraded GPS and dropout drives', () => {
    const results = runNavigationScenarioSuite(createNavigationScenarioSuite().slice(0, 3));
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results[2].drive.continuitySamples).toBeGreaterThan(0);
  });

  it('keeps unsafe lane-change scenarios from becoming change-now', () => {
    const results = runNavigationScenarioSuite(createNavigationScenarioSuite().filter((scenario) => scenario.kind === 'blocked-lane-change' || scenario.kind === 'unsafe-lane-change'));
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.every((result) => result.maneuverDecision?.action !== 'change-now')).toBe(true);
  });

  it('keeps physical continuity through a lane-count merge', () => {
    const result = runNavigationScenarioSuite(createNavigationScenarioSuite().filter((scenario) => scenario.kind === 'complex-junction'))[0];
    expect(result.passed).toBe(true);
    expect(result.junctionResolution?.kind).toBe('merge');
    expect(result.junctionResolution?.continuous).toBe(true);
  });
});
