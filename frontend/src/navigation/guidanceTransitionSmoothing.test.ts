import { GuidanceTransitionSmoother } from './guidanceTransitionSmoothing';

describe('GuidanceTransitionSmoother', () => {
  it('does not snap authority when fallback level changes', () => {
    const smoother = new GuidanceTransitionSmoother(1000);
    smoother.update('route-a', { level: 'lane', lane: 1, branch: 0.8, continuity: 0.7 }, 0);
    const next = smoother.update('route-a', { level: 'junction', lane: 0.2, branch: 0.9, continuity: 0.7 }, 100);
    expect(next.previousLevel).toBe('lane');
    expect(next.lane).toBeGreaterThan(0.2);
    expect(next.lane).toBeLessThan(1);
  });

  it('fully converges after the transition window', () => {
    const smoother = new GuidanceTransitionSmoother(500);
    smoother.update('route-a', { level: 'route', lane: 0.1, branch: 0.2, continuity: 0.9 }, 0);
    const next = smoother.update('route-a', { level: 'maneuver', lane: 0, branch: 0.05, continuity: 0.2 }, 500);
    expect(next.previousLevel).toBeNull();
    expect(next.lane).toBeCloseTo(0);
    expect(next.continuity).toBeCloseTo(0.2);
  });

  it('resets cleanly for a new guidance corridor', () => {
    const smoother = new GuidanceTransitionSmoother();
    smoother.update('route-a', { level: 'lane', lane: 1, branch: 1, continuity: 1 }, 0);
    const next = smoother.update('route-b', { level: 'route', lane: 0, branch: 0.1, continuity: 0.7 }, 100);
    expect(next.previousLevel).toBeNull();
    expect(next.level).toBe('route');
    expect(next.lane).toBe(0);
  });
});
