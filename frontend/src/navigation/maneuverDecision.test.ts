import { decideUnifiedManeuver } from './maneuverDecision';
import { DestinationLaneTiming } from './destinationLaneIntelligence';
import { LaneChangeReachability } from './laneChangeReachability';

const timing: DestinationLaneTiming = {
  targetLaneIndex: 1, currentLaneIndex: 0, laneDelta: 1, direction: 'right', laneChanges: 1,
  earliestChangeMeters: 70, latestChangeMeters: 100, urgency: 'prepare', confidence: 0.95,
};
const reachable: LaneChangeReachability = {
  reachable: true, confidence: 0.9, requiredRunwayMeters: 45, remainingMeters: 100, reason: 'reachable',
  dynamics: { safe: true, confidence: 0.92, requiredDistanceMeters: 45, recommendedSpeedMps: 14, laneChangeTimeSeconds: 3, estimatedLateralAccelerationMps2: 0.8, estimatedLateralRateMps: 0.7, brakingDistanceMeters: 0, reactionDistanceMeters: 10, reason: 'safe' },
  trafficSafe: true, trafficConfidence: 0.9, trafficReason: 'safe',
};

test('unified decision prepares when safe and not urgent', () => {
  const result = decideUnifiedManeuver({ timing, reachability: reachable, currentLaneConfidence: 0.9, distanceToManeuverMeters: 100 });
  expect(result.action).toBe('prepare');
  expect(result.safe).toBe(true);
});

test('unified decision changes now when timing is urgent', () => {
  const result = decideUnifiedManeuver({ timing: { ...timing, urgency: 'change-now' }, reachability: reachable, currentLaneConfidence: 0.9, distanceToManeuverMeters: 55 });
  expect(result.action).toBe('change-now');
  expect(result.safe).toBe(true);
});

test('unsafe traffic becomes uncertain while recovery distance remains', () => {
  const result = decideUnifiedManeuver({ timing, reachability: { ...reachable, reachable: false, confidence: 0.65, reason: 'unsafe-gap', trafficSafe: false, trafficConfidence: 0.5, trafficReason: 'unsafe-gap' }, currentLaneConfidence: 0.9, distanceToManeuverMeters: 80 });
  expect(result.action).toBe('uncertain');
  expect(result.safe).toBe(false);
});

test('too-late maneuver becomes reroute decision', () => {
  const result = decideUnifiedManeuver({ timing: { ...timing, urgency: 'too-late', latestChangeMeters: 0 }, reachable, currentLaneConfidence: 0.9, distanceToManeuverMeters: 8 });
  expect(result.action).toBe('reroute');
});
