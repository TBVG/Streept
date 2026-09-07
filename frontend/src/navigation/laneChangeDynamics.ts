import { LaneChangeTrajectory } from './laneChangeTrajectory';

export interface LaneChangeDynamicsInput {
  trajectory: LaneChangeTrajectory | null;
  currentSpeedMps: number;
  distanceToManeuverMeters: number;
  reactionTimeSeconds?: number;
  comfortableLateralAccelerationMps2?: number;
  comfortableLateralRateMps?: number;
  comfortableBrakingMps2?: number;
  safetyBufferMeters?: number;
}

export interface LaneChangeDynamics {
  safe: boolean;
  confidence: number;
  requiredDistanceMeters: number;
  recommendedSpeedMps: number;
  laneChangeTimeSeconds: number;
  estimatedLateralAccelerationMps2: number;
  estimatedLateralRateMps: number;
  brakingDistanceMeters: number;
  reactionDistanceMeters: number;
  reason: 'same-lane' | 'no-trajectory' | 'invalid-geometry' | 'speed-too-high' | 'insufficient-reaction-distance' | 'lateral-load-too-high' | 'safe';
}

/**
 * Conservative, renderer-independent vehicle dynamics heuristic.
 * This is not a certified vehicle model: it estimates whether a smoothstep
 * lane transition can be performed comfortably at the current speed and with
 * enough distance to react and slow down first.
 */
export function assessLaneChangeDynamics(input: LaneChangeDynamicsInput): LaneChangeDynamics {
  const reactionTime = Math.max(0.5, input.reactionTimeSeconds ?? 1.0);
  const maxLatAccel = Math.max(0.5, input.comfortableLateralAccelerationMps2 ?? 1.5);
  const maxLatRate = Math.max(0.5, input.comfortableLateralRateMps ?? 1.25);
  const comfortableBraking = Math.max(1.5, input.comfortableBrakingMps2 ?? 3.5);
  const safetyBuffer = Math.max(6, input.safetyBufferMeters ?? 8);
  const speed = Math.max(0, Number.isFinite(input.currentSpeedMps) ? input.currentSpeedMps : 0);
  const remaining = Math.max(0, input.distanceToManeuverMeters);

  if (!input.trajectory || input.trajectory.sourceLane === input.trajectory.targetLane) {
    return {
      safe: true, confidence: input.trajectory ? 1 : 0, requiredDistanceMeters: 0,
      recommendedSpeedMps: speed, laneChangeTimeSeconds: 0, estimatedLateralAccelerationMps2: 0,
      estimatedLateralRateMps: 0, brakingDistanceMeters: 0, reactionDistanceMeters: 0,
      reason: input.trajectory ? 'same-lane' : 'no-trajectory',
    };
  }
  if (!input.trajectory.reachable || input.trajectory.lengthMeters <= 1 || input.trajectory.lateralShiftMeters <= 0) {
    return {
      safe: false, confidence: input.trajectory.confidence, requiredDistanceMeters: input.trajectory.lengthMeters,
      recommendedSpeedMps: Math.min(speed, 10), laneChangeTimeSeconds: 0,
      estimatedLateralAccelerationMps2: Infinity, estimatedLateralRateMps: Infinity,
      brakingDistanceMeters: 0, reactionDistanceMeters: speed * reactionTime, reason: 'invalid-geometry',
    };
  }

  const length = Math.max(1, input.trajectory.lengthMeters);
  const lateralShift = Math.max(0.1, input.trajectory.lateralShiftMeters);
  // For y = D(3u^2 - 2u^3), max |y''| = 6D/T^2 and max |y'| = 1.5D/T.
  const maxSpeedFromAccel = length * Math.sqrt(maxLatAccel / (6 * lateralShift));
  const maxSpeedFromRate = length * maxLatRate / (1.5 * lateralShift);
  const recommendedSpeed = Math.max(3, Math.min(33, maxSpeedFromAccel, maxSpeedFromRate));
  const executionSpeed = Math.max(3, Math.min(speed || recommendedSpeed, recommendedSpeed));
  const laneChangeTime = length / executionSpeed;
  const estimatedLatAccel = 6 * lateralShift / (laneChangeTime * laneChangeTime);
  const estimatedLatRate = 1.5 * lateralShift / laneChangeTime;

  const reactionDistance = speed * reactionTime;
  const brakingDistance = speed > recommendedSpeed
    ? Math.max(0, (speed * speed - recommendedSpeed * recommendedSpeed) / (2 * comfortableBraking))
    : 0;
  const requiredDistance = reactionDistance + brakingDistance + length + safetyBuffer;
  const margin = remaining - requiredDistance;
  const dynamicsComfort = Math.min(maxLatAccel / Math.max(estimatedLatAccel, 0.001), maxLatRate / Math.max(estimatedLatRate, 0.001));
  const confidence = Math.max(0.35, Math.min(0.98, input.trajectory.confidence * (margin >= 0 ? 0.92 : 0.68) * Math.min(1, dynamicsComfort)));

  if (estimatedLatAccel > maxLatAccel * 1.01 || estimatedLatRate > maxLatRate * 1.01) {
    return { safe: false, confidence, requiredDistanceMeters: requiredDistance, recommendedSpeedMps: recommendedSpeed, laneChangeTimeSeconds: laneChangeTime, estimatedLateralAccelerationMps2: estimatedLatAccel, estimatedLateralRateMps: estimatedLatRate, brakingDistanceMeters: brakingDistance, reactionDistanceMeters: reactionDistance, reason: 'lateral-load-too-high' };
  }
  if (speed > recommendedSpeed * 1.05 && remaining < requiredDistance) {
    return { safe: false, confidence, requiredDistanceMeters: requiredDistance, recommendedSpeedMps: recommendedSpeed, laneChangeTimeSeconds: laneChangeTime, estimatedLateralAccelerationMps2: estimatedLatAccel, estimatedLateralRateMps: estimatedLatRate, brakingDistanceMeters: brakingDistance, reactionDistanceMeters: reactionDistance, reason: 'insufficient-reaction-distance' };
  }
  if (margin < 0) {
    return { safe: false, confidence, requiredDistanceMeters: requiredDistance, recommendedSpeedMps: recommendedSpeed, laneChangeTimeSeconds: laneChangeTime, estimatedLateralAccelerationMps2: estimatedLatAccel, estimatedLateralRateMps: estimatedLatRate, brakingDistanceMeters: brakingDistance, reactionDistanceMeters: reactionDistance, reason: 'insufficient-reaction-distance' };
  }
  return { safe: true, confidence, requiredDistanceMeters: requiredDistance, recommendedSpeedMps: recommendedSpeed, laneChangeTimeSeconds: laneChangeTime, estimatedLateralAccelerationMps2: estimatedLatAccel, estimatedLateralRateMps: estimatedLatRate, brakingDistanceMeters: brakingDistance, reactionDistanceMeters: reactionDistance, reason: 'safe' };
}
