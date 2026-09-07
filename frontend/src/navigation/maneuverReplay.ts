import { Location, SceneRoad } from '../types';
import { NavigationEngine } from './navigationEngine';
import { routeForSimulation } from './navigationSimulation';
import { buildLaneChangeTrajectory } from './laneChangeTrajectory';
import { assessLaneChangeDynamics, LaneChangeDynamics } from './laneChangeDynamics';
import { assessLaneChangeTrafficSafety, LaneOccupantObservation } from './laneChangeTrafficSafety';
import { assessLaneChangeReachability, LaneChangeReachability } from './laneChangeReachability';
import { buildDestinationLaneTiming, DestinationLaneTiming } from './destinationLaneIntelligence';
import { decideUnifiedManeuver, UnifiedManeuverDecision } from './maneuverDecision';
import { LaneChangeExecutionState } from './laneChangeExecution';
import { SimulationSample } from './navigationSimulation';
import { haversineDistanceMeters } from '../utils/geo';

export interface ManeuverReplayConfig {
  route: Location[];
  sourceLane: number;
  targetLane: number;
  maneuverDistanceMeters: number;
  speedMps?: number;
  stepMs?: number;
  gpsAccuracyMeters?: number;
  dropoutWindowsMs?: Array<{ start: number; end: number }>;
  blockerWindows?: Array<{ startMs: number; endMs: number }>;
  rerouteOnMiss?: boolean;
}

export interface ManeuverReplayFrame {
  timestampMs: number;
  distanceToManeuverMeters: number;
  decision: UnifiedManeuverDecision;
  execution: LaneChangeExecutionState;
  dynamics: LaneChangeDynamics | null;
  reachability: LaneChangeReachability;
  trafficSafe: boolean;
  trafficReason: string | null;
  gpsDropout: boolean;
  drive: SimulationSample | null;
  rerouted: boolean;
}

export interface ManeuverReplayResult {
  frames: ManeuverReplayFrame[];
  completed: boolean;
  blockedFrames: number;
  dropoutFrames: number;
  rerouteCount: number;
  finalExecution: LaneChangeExecutionState;
  finalNavigationState: string;
  failures: string[];
}

const ROAD: SceneRoad = {
  osm_id: 901,
  node_ids: [1, 2],
  geometry: [{ lat: 21.1458, lng: 79.0882 }, { lat: 21.151, lng: 79.095 }],
  highway: 'primary',
  name: null,
  lanes: 3,
  oneway: true,
};

function routeLength(route: Location[]): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) total += haversineDistanceMeters(route[i], route[i + 1]);
  return total;
}

function bearing(a: Location, b: Location): number {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function interpolate(route: Location[], distance: number): Location {
  if (!route.length) return { lat: 0, lng: 0 };
  let remaining = Math.max(0, distance);
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    const length = haversineDistanceMeters(a, b);
    if (remaining <= length || i === route.length - 2) {
      const t = length > 0 ? Math.min(1, remaining / length) : 0;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    remaining -= length;
  }
  return route[route.length - 1];
}

function inWindow(timestampMs: number, windows: Array<{ startMs: number; endMs: number }> | undefined): boolean {
  return (windows ?? []).some((w) => timestampMs >= w.startMs && timestampMs < w.endMs);
}

function dropout(timestampMs: number, windows: ManeuverReplayConfig['dropoutWindowsMs']): boolean {
  return (windows ?? []).some((w) => timestampMs >= w.start && timestampMs < w.end);
}

function blocker(id: string, location: Location, timestampMs: number): LaneOccupantObservation {
  return { id, location, laneIndex: 1, speedMps: 8, headingDegrees: 90, observedAtMs: timestampMs, confidence: 0.95 };
}



function activeEngine(route: Location[]): NavigationEngine {
  const engine = new NavigationEngine({ now: () => 0 });
  engine.setRoute(routeForSimulation(route));
  engine.dispatch({ type: 'PLAN', hasRoute: true });
  engine.dispatch({ type: 'START', hasRoute: true });
  return engine;
}

/**
 * Time-stepped replay of a physical lane-change request. Unlike the static
 * scenario suite, this drives the production execution state machine on every
 * frame and can change traffic/GPS conditions while the maneuver is underway.
 */
export function replayManeuver(config: ManeuverReplayConfig): ManeuverReplayResult {
  const stepMs = Math.max(100, config.stepMs ?? 400);
  const speedMps = Math.max(1, config.speedMps ?? 12);
  const route = config.route;
  const engine = activeEngine(route);
  const trajectory = buildLaneChangeTrajectory(ROAD, config.sourceLane, config.targetLane, 48);
  const length = routeLength(route);
  const startDistance = Math.max(config.maneuverDistanceMeters + 120, config.maneuverDistanceMeters);
  const durationMs = Math.ceil(Math.min(length, startDistance + 45) / speedMps * 1000);
  const frames: ManeuverReplayFrame[] = [];
  let currentLane = config.sourceLane;
  let rerouteCount = 0;
  let previousProgress = -Infinity;
  let observedMaxProgress = -Infinity;
  let blockedFrames = 0;
  let dropoutFrames = 0;

  for (let elapsed = 0; elapsed <= durationMs; elapsed += stepMs) {
    const timestampMs = elapsed;
    const traveled = Math.min(length, speedMps * elapsed / 1000);
    const distanceToManeuver = Math.max(0, startDistance - traveled);
    const truth = interpolate(route, traveled);
    const next = interpolate(route, Math.min(length, traveled + Math.max(2, speedMps * 0.5)));
    const gpsDropout = dropout(timestampMs, config.dropoutWindowsMs);
    let drive: SimulationSample;
    let fix;
    if (gpsDropout) {
      const continuity = engine.tickContinuity(timestampMs);
      fix = continuity;
      dropoutFrames += 1;
    } else {
      fix = engine.acceptGpsFix({ location: truth, timestampMs, accuracyMeters: config.gpsAccuracyMeters ?? 5, speedMps, headingDegrees: bearing(truth, next), motion: { timestampMs, speedMps, headingDegrees: bearing(truth, next), accelerationMps2: 0 } });
    }
    const snapshot = engine.snapshot();
    const progress = snapshot.matched?.progressMeters ?? previousProgress;
    observedMaxProgress = Math.max(observedMaxProgress, progress);
    previousProgress = observedMaxProgress;
    drive = {
      timestampMs,
      truth,
      engineLocation: fix.location,
      progressMeters: progress,
      truthProgressMeters: traveled,
      accepted: fix.accepted,
      usedContinuity: gpsDropout && fix.accepted,
      health: fix.health,
      speedMps: fix.speedMps,
      motionConfidence: fix.motionConfidence,
    };

    const blocked = inWindow(timestampMs, config.blockerWindows);
    if (blocked) blockedFrames += 1;
    const blockerPoint = trajectory.points.length ? trajectory.points[Math.floor(trajectory.points.length / 2)] : truth;
    const occupants = blocked ? [blocker('replay-blocker', blockerPoint, timestampMs)] : [];
    const dynamics = assessLaneChangeDynamics({ trajectory, currentSpeedMps: speedMps, distanceToManeuverMeters: distanceToManeuver });
    const traffic = assessLaneChangeTrafficSafety({ trajectory, targetLane: config.targetLane, occupants, reports: [], nowMs: timestampMs });
    const reachability = assessLaneChangeReachability({
      trajectory,
      distanceToManeuverMeters: distanceToManeuver,
      currentLaneIndex: currentLane,
      currentLaneConfidence: gpsDropout ? Math.min(0.48, drive.health.confidence) : Math.max(0.72, drive.health.confidence),
      speedMps,
      occupants,
      reports: [],
      nowMs: timestampMs,
    });
    const timing: DestinationLaneTiming = buildDestinationLaneTiming(config.sourceLane, config.targetLane, distanceToManeuver);
    const decision = decideUnifiedManeuver({ timing, reachability, currentLaneConfidence: gpsDropout ? 0.48 : 0.9, distanceToManeuverMeters: distanceToManeuver });

    // Simulate the physical vehicle crossing the lane only when the decision is
    // actionable and the target lane is safe. Two consecutive target-lane
    // observations are required by the execution tracker before completion.
    if (decision.action === 'change-now' && reachability.reachable && !gpsDropout && !blocked) {
      currentLane = config.targetLane;
    }

    const execution = engine.updateLaneChangeExecution({
      currentLaneIndex: currentLane,
      currentLaneConfidence: gpsDropout ? 0.48 : 0.9,
      timing,
      reachable: reachability.reachable,
      reachabilityConfidence: reachability.confidence,
      dynamicsConfidence: dynamics.confidence,
      recommendedSpeedMps: dynamics.recommendedSpeedMps,
      safetyReason: reachability.reachable ? null : reachability.reason,
      distanceToManeuverMeters: distanceToManeuver,
      nowMs: timestampMs,
    });

    let rerouted = false;
    if (execution.phase === 'missed' && config.rerouteOnMiss !== false && engine.snapshot().state.phase !== 'rerouting') {
      engine.dispatch({ type: 'REROUTE' });
      engine.dispatch({ type: 'REROUTE_SUCCEEDED' });
      rerouteCount += 1;
      rerouted = true;
    }
    frames.push({ timestampMs, distanceToManeuverMeters: distanceToManeuver, decision, execution, dynamics, reachability, trafficSafe: traffic.safe, trafficReason: traffic.reason, gpsDropout, drive, rerouted });
    if (execution.phase === 'completed' || rerouteCount > 0) break;
  }

  const finalExecution = frames.length ? frames[frames.length - 1].execution : engine.snapshot().laneChangeExecution;
  const failures: string[] = [];
  const completed = finalExecution.phase === 'completed';
  if (!completed && rerouteCount === 0) failures.push('maneuver did not complete or reroute');
  if (blockedFrames > 0 && frames.some((f) => inWindow(f.timestampMs, config.blockerWindows) && f.decision.action === 'change-now' && f.reachability.reachable && f.trafficSafe)) failures.push('blocked lane was treated as safe');
  if (dropoutFrames > 0 && !frames.some((f) => f.gpsDropout && f.drive?.usedContinuity === true)) failures.push('GPS dropout did not use continuity');
  if (frames.some((f, index) => index > 0 && f.drive?.accepted === true && f.drive.progressMeters + 1 < Math.max(...frames.slice(0, index).map((prior) => prior.drive?.progressMeters ?? -Infinity)))) failures.push('replay progress regressed');
  return { frames, completed, blockedFrames, dropoutFrames, rerouteCount, finalExecution, finalNavigationState: engine.snapshot().state.phase, failures };
}
