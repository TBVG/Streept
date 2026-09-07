import { LaneChangeTrajectory } from './laneChangeTrajectory';
import { LaneChangeDynamics, assessLaneChangeDynamics } from './laneChangeDynamics';
import { LaneOccupantObservation, assessLaneChangeTrafficSafety } from './laneChangeTrafficSafety';
import { Report } from '../types';

export interface LaneChangeReachabilityInput {
  trajectory: LaneChangeTrajectory | null;
  distanceToManeuverMeters: number;
  currentLaneIndex: number | null;
  currentLaneConfidence: number;
  minimumConfidence?: number;
  speedMps?: number;
  reports?: Report[];
  occupants?: LaneOccupantObservation[];
  nowMs?: number;
}

export interface LaneChangeReachability {
  reachable: boolean;
  confidence: number;
  requiredRunwayMeters: number;
  remainingMeters: number;
  reason: 'same-lane' | 'no-trajectory' | 'unreachable-geometry' | 'insufficient-runway' | 'low-confidence' | 'speed-too-high' | 'insufficient-reaction-distance' | 'lateral-load-too-high' | 'target-lane-blocked' | 'unsafe-gap' | 'reachable';
  dynamics: LaneChangeDynamics | null;
  trafficSafe: boolean;
  trafficConfidence: number;
  trafficReason: string | null;
}

/**
 * Converts a physical lane-change trajectory into an execution-time decision.
 * The old execution layer knew only the abstract lane count and therefore
 * treated every requested change as reachable. This gate uses the actual
 * scene trajectory length plus the live distance-to-maneuver and lane-match
 * confidence before allowing the execution state machine to enter `changing`.
 */
export function assessLaneChangeReachability(input: LaneChangeReachabilityInput): LaneChangeReachability {
  const minimumConfidence = input.minimumConfidence ?? 0.55;
  if (input.currentLaneIndex == null) {
    return { reachable: false, confidence: 0, requiredRunwayMeters: 0, remainingMeters: input.distanceToManeuverMeters, reason: 'low-confidence', dynamics: null, trafficSafe: false, trafficConfidence: 0, trafficReason: 'low-confidence' };
  }
  if (input.trajectory && input.trajectory.sourceLane === input.trajectory.targetLane) {
    return { reachable: true, confidence: 1, requiredRunwayMeters: 0, remainingMeters: input.distanceToManeuverMeters, reason: 'same-lane', dynamics: null, trafficSafe: true, trafficConfidence: 1, trafficReason: 'same-lane' };
  }
  if (!input.trajectory) {
    return { reachable: false, confidence: 0, requiredRunwayMeters: 0, remainingMeters: input.distanceToManeuverMeters, reason: 'no-trajectory', dynamics: null, trafficSafe: false, trafficConfidence: 0, trafficReason: 'no-trajectory' };
  }
  if (!input.trajectory.reachable || input.trajectory.points.length < 2) {
    return { reachable: false, confidence: input.trajectory.confidence, requiredRunwayMeters: input.trajectory.lengthMeters, remainingMeters: input.distanceToManeuverMeters, reason: input.trajectory.reason === 'insufficient-runway' ? 'insufficient-runway' : 'unreachable-geometry', dynamics: null, trafficSafe: false, trafficConfidence: 0, trafficReason: 'unreachable-geometry' };
  }
  const safetyBuffer = 8;
  const requiredRunwayMeters = input.trajectory.lengthMeters + safetyBuffer;
  const runwayMargin = input.distanceToManeuverMeters - requiredRunwayMeters;
  const confidence = Math.min(input.currentLaneConfidence, input.trajectory.confidence);
  if (confidence < minimumConfidence) {
    return { reachable: false, confidence, requiredRunwayMeters, remainingMeters: input.distanceToManeuverMeters, reason: 'low-confidence', dynamics: null, trafficSafe: false, trafficConfidence: 0, trafficReason: 'low-confidence' };
  }
  if (runwayMargin < 0) {
    return { reachable: false, confidence, requiredRunwayMeters, remainingMeters: input.distanceToManeuverMeters, reason: 'insufficient-runway', dynamics: null, trafficSafe: false, trafficConfidence: 0, trafficReason: 'insufficient-runway' };
  }
  const marginConfidence = Math.max(0.45, Math.min(1, runwayMargin / 40 + 0.55));
  const dynamics = assessLaneChangeDynamics({
    trajectory: input.trajectory,
    currentSpeedMps: input.speedMps ?? 0,
    distanceToManeuverMeters: input.distanceToManeuverMeters,
  });
  const traffic = assessLaneChangeTrafficSafety({ trajectory: input.trajectory, targetLane: input.trajectory.targetLane, reports: input.reports, occupants: input.occupants, nowMs: input.nowMs });
  const combinedConfidence = Math.min(confidence, marginConfidence, dynamics.confidence, traffic.confidence);
  if (!dynamics.safe) {
    return {
      reachable: false,
      confidence: combinedConfidence,
      requiredRunwayMeters: Math.max(requiredRunwayMeters, dynamics.requiredDistanceMeters),
      remainingMeters: input.distanceToManeuverMeters,
      reason: dynamics.reason === 'speed-too-high' ? 'speed-too-high' : dynamics.reason === 'lateral-load-too-high' ? 'lateral-load-too-high' : 'insufficient-reaction-distance',
      dynamics, trafficSafe: traffic.safe, trafficConfidence: traffic.confidence, trafficReason: traffic.reason,
    };
  }
  if (!traffic.safe) return { reachable: false, confidence: combinedConfidence, requiredRunwayMeters: Math.max(requiredRunwayMeters, dynamics.requiredDistanceMeters), remainingMeters: input.distanceToManeuverMeters, reason: traffic.reason === 'target-lane-blocked' ? 'target-lane-blocked' : 'unsafe-gap', dynamics, trafficSafe: false, trafficConfidence: traffic.confidence, trafficReason: traffic.reason };
  return { reachable: true, confidence: combinedConfidence, requiredRunwayMeters: Math.max(requiredRunwayMeters, dynamics.requiredDistanceMeters), remainingMeters: input.distanceToManeuverMeters, reason: 'reachable', dynamics, trafficSafe: true, trafficConfidence: traffic.confidence, trafficReason: traffic.reason };
}
