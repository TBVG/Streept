import { describe, expect, it } from 'vitest';
import { planPredictiveLaneChange } from './predictiveLanePlanning';
import { LaneChangeReachability } from './laneChangeReachability';

const reachable = (overrides: Partial<LaneChangeReachability> = {}): LaneChangeReachability => ({
  reachable: true, confidence: 0.9, requiredRunwayMeters: 35, remainingMeters: 120,
  reason: 'reachable', dynamics: null, trafficSafe: true, trafficConfidence: 0.9, trafficReason: 'safe', ...overrides,
});

describe('predictive lane planning', () => {
  it('schedules only the next adjacent step for a multi-lane request', () => {
    const plan = planPredictiveLaneChange({ currentLaneIndex: 0, finalTargetLaneIndex: 2, distanceToManeuverMeters: 180, latestChangeMeters: 100, reachability: reachable() });
    expect(plan.immediateTargetLaneIndex).toBe(1);
    expect(plan.finalTargetLaneIndex).toBe(2);
    expect(plan.remainingLaneChanges).toBe(2);
    expect(plan.action).toBe('prepare');
  });

  it('waits for a safe gap while enough runway remains', () => {
    const plan = planPredictiveLaneChange({ currentLaneIndex: 1, finalTargetLaneIndex: 2, distanceToManeuverMeters: 140, latestChangeMeters: 90, reachability: reachable({ reachable: false, trafficSafe: false, trafficConfidence: 0.7, trafficReason: 'unsafe-gap', reason: 'unsafe-gap' }) });
    expect(plan.action).toBe('wait-for-gap');
    expect(plan.safeToExecuteNow).toBe(false);
  });

  it('reroutes when the blocked step is inside its final runway', () => {
    const plan = planPredictiveLaneChange({ currentLaneIndex: 1, finalTargetLaneIndex: 2, distanceToManeuverMeters: 18, latestChangeMeters: 10, reachability: reachable({ reachable: false, trafficSafe: false, trafficConfidence: 0.7, trafficReason: 'unsafe-gap', reason: 'unsafe-gap' }) });
    expect(plan.action).toBe('reroute');
  });

  it('re-evaluates from the new lane after an adjacent step completes', () => {
    const plan = planPredictiveLaneChange({ currentLaneIndex: 1, finalTargetLaneIndex: 2, distanceToManeuverMeters: 80, latestChangeMeters: 50, reachability: reachable() });
    expect(plan.immediateTargetLaneIndex).toBe(2);
    expect(plan.remainingLaneChanges).toBe(1);
  });
});
