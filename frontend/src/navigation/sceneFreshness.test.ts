import { buildSceneFreshnessPlan, SceneFreshnessTracker } from './sceneFreshness';

describe('sceneFreshness', () => {
  it('keeps fresh scenes at full detail', () => {
    const plan = buildSceneFreshnessPlan({ fetchedAtMs: 1000, nowMs: 30_000 });
    expect(plan.state).toBe('fresh');
    expect(plan.detailScale).toBe(1);
    expect(plan.keepRouteContinuity).toBe(true);
  });
  it('ages world context before declaring it stale', () => {
    const plan = buildSceneFreshnessPlan({ fetchedAtMs: 0, nowMs: 180_000 });
    expect(plan.state).toBe('aging');
    expect(plan.worldAlpha).toBeLessThan(0.72);
  });
  it('makes stale context subordinate without removing route continuity', () => {
    const plan = buildSceneFreshnessPlan({ fetchedAtMs: 0, nowMs: 300_001 });
    expect(plan.state).toBe('stale');
    expect(plan.detailScale).toBe(0.56);
    expect(plan.keepRouteContinuity).toBe(true);
  });
  it('tracks first acquisition once', () => {
    const tracker = new SceneFreshnessTracker();
    tracker.markIfMissing('a', 1000);
    tracker.markIfMissing('a', 2000);
    expect(tracker.getFetchedAt('a')).toBe(1000);
  });
});
