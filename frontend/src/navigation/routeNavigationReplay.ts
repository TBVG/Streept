import { Location, Report, SceneContext, SceneRoad } from '../types';
import { NavigationEngine } from './navigationEngine';
import { routeForSimulation, SimulationSample } from './navigationSimulation';
import { buildLaneChangeTrajectory } from './laneChangeTrajectory';
import { assessLaneChangeDynamics, LaneChangeDynamics } from './laneChangeDynamics';
import { assessLaneChangeTrafficSafety, LaneOccupantObservation } from './laneChangeTrafficSafety';
import { assessLaneChangeReachability, LaneChangeReachability } from './laneChangeReachability';
import { buildDestinationLaneTiming, DestinationLaneTiming } from './destinationLaneIntelligence';
import { decideUnifiedManeuver, UnifiedManeuverDecision } from './maneuverDecision';
import { LaneChangeExecutionState } from './laneChangeExecution';
import { haversineDistanceMeters } from '../utils/geo';
import { resolveComplexJunctionLane, ComplexJunctionResolution } from './complexJunctionLaneResolver';
import { buildPhysicalLaneTopology } from './physicalLaneTopology';
import { buildLaneCenterline } from './laneGeometry';
import { buildJunctionLaneContinuity } from './junctionLaneContinuity';
import { deriveSceneWaySequence } from './turnRestrictionGraph';

export interface RouteReplayManeuver {
  id: string;
  distanceMeters?: number;
  location?: Location;
  sourceLane: number;
  targetLane: number;
  junction?: boolean;
}

export interface RouteReplayVehicleTrack {
  id: string;
  laneIndex: number;
  wayId?: number;
  startProgressMeters: number;
  speedMps: number;
  startMs?: number;
  endMs?: number;
  laneChanges?: Array<{ atMs: number; laneIndex: number }>;
}

export interface RouteReplayBlockerWindow {
  maneuverId: string;
  startMs: number;
  endMs: number;
  vehicleId: string;
}

export interface RouteReplayConfig {
  route: Location[];
  maneuvers: RouteReplayManeuver[];
  replacementRoute?: Location[];
  speedMps?: number;
  stepMs?: number;
  gpsDropoutWindowsMs?: Array<{ start: number; end: number }>;
  blockerWindows?: RouteReplayBlockerWindow[];
  vehicleTracks?: RouteReplayVehicleTrack[];
  closedLaneManeuverIds?: string[];
  rerouteOnMiss?: boolean;
  scene?: SceneContext | null;
}

export interface RouteReplayFrame {
  timestampMs: number;
  truthProgressMeters: number;
  distanceToManeuverMeters: number | null;
  activeManeuverId: string | null;
  decision: UnifiedManeuverDecision;
  execution: LaneChangeExecutionState;
  timing: DestinationLaneTiming | null;
  dynamics: LaneChangeDynamics | null;
  reachability: LaneChangeReachability | null;
  trafficSafe: boolean;
  trafficReason: string | null;
  activeVehicles: number;
  gpsDropout: boolean;
  drive: SimulationSample;
  rerouted: boolean;
  routeGeneration: number;
  junctionResolution: ComplexJunctionResolution | null;
}

export interface RouteReplayResult {
  frames: RouteReplayFrame[];
  completed: boolean;
  maneuverCompletions: string[];
  missedManeuvers: string[];
  junctionFrames: number;
  rerouteCount: number;
  replacementRouteUsed: boolean;
  maxActiveVehicles: number;
  failures: string[];
  resolvedManeuverDistances: Record<string, number>;
}

function cumulativeRouteDistances(route: Location[]): number[] {
  const out = [0];
  for (let i = 1; i < route.length; i += 1) out.push(out[i - 1] + haversineDistanceMeters(route[i - 1], route[i]));
  return out;
}

function nearestRouteDistance(route: Location[], location: Location): number {
  if (!route.length) return 0;
  const cumulative = cumulativeRouteDistances(route);
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < route.length; i += 1) {
    const d = haversineDistanceMeters(route[i], location);
    if (d < bestDistance) { bestDistance = d; best = cumulative[i]; }
  }
  return best;
}

function resolveManeuverDistance(route: Location[], maneuver: RouteReplayManeuver): number {
  if (maneuver.distanceMeters != null && Number.isFinite(maneuver.distanceMeters)) return Math.max(0, maneuver.distanceMeters);
  return nearestRouteDistance(route, maneuver.location ?? route[route.length - 1] ?? { lat: 0, lng: 0 });
}

function routeRoad(route: Location[], osmId: number): SceneRoad {
  return { osm_id: osmId, node_ids: route.map((_, i) => i + 1), geometry: route.map((p) => ({ ...p })), highway: 'primary', name: 'Replay route', lanes: 3, oneway: true };
}

function routePointDistance(a: Location, b: Location): number {
  return Math.hypot((a.lat - b.lat) * 110540, (a.lng - b.lng) * 111320 * Math.max(0.2, Math.cos(a.lat * Math.PI / 180)));
}

function sceneRoadNearLocation(scene: SceneContext | null | undefined, location: Location): SceneRoad | null {
  if (!scene?.roads?.length) return null;
  let best: SceneRoad | null = null;
  let bestDistance = Infinity;
  for (const road of scene.roads) {
    if (road.geometry.length < 2) continue;
    const distance = Math.min(...road.geometry.map((point) => routePointDistance(point, location)));
    if (distance < bestDistance) { bestDistance = distance; best = road; }
  }
  return bestDistance <= 100 ? best : null;
}

function sceneRoadForRoute(scene: SceneContext | null | undefined, route: Location[], atDistance: number): SceneRoad | null {
  if (!scene?.roads?.length || route.length < 2) return null;
  const point = interpolate(route, atDistance);
  return sceneRoadNearLocation(scene, point);
}

function sceneRoadPairForJunction(scene: SceneContext | null | undefined, route: Location[], distance: number): { fromRoad: SceneRoad; toRoad: SceneRoad } | null {
  if (!scene?.roads?.length) return null;
  const cumulative = cumulativeRouteDistances(route);
  let index = cumulative.findIndex((d) => d >= distance);
  if (index < 1) index = 1;
  if (index >= route.length - 1) index = route.length - 2;
  const coords = route.slice(Math.max(0, index - 2), Math.min(route.length, index + 3));
  const sequence = deriveSceneWaySequence(coords, scene.roads);
  const ids = sequence.length >= 2 ? sequence : [
    sceneRoadNearLocation(scene, route[Math.max(0, index - 1)])?.osm_id ?? null,
    sceneRoadNearLocation(scene, route[Math.min(route.length - 1, index + 1)])?.osm_id ?? null,
  ];
  const fromId = ids[ids.length - 2];
  const toId = ids[ids.length - 1];
  const fromRoad = fromId != null ? scene.roads.find((road) => road.osm_id === fromId) : null;
  const toRoad = toId != null ? scene.roads.find((road) => road.osm_id === toId) : null;
  return fromRoad && toRoad ? { fromRoad, toRoad } : null;
}

function routeJunctionRoads(route: Location[], index: number): { fromRoad: SceneRoad; toRoad: SceneRoad } {
  const split = Math.max(1, Math.min(route.length - 2, index));
  const from = route.slice(Math.max(0, split - 2), split + 1);
  const to = route.slice(split, Math.min(route.length, split + 3));
  const node = split + 1;
  return {
    fromRoad: { ...routeRoad(from.length >= 2 ? from : route.slice(0, 2), 7000 + split), node_ids: Array.from({ length: Math.max(2, from.length) }, (_, i) => node - Math.max(1, from.length - 1) + i) },
    toRoad: { ...routeRoad(to.length >= 2 ? to : route.slice(-2), 8000 + split), node_ids: Array.from({ length: Math.max(2, to.length) }, (_, i) => node + i) },
  };
}

function pointAlongRoadLane(road: SceneRoad, laneIndex: number, progressMeters: number): Location | null {
  const lane = buildLaneCenterline(road, Math.max(0, laneIndex), Math.max(1, Math.min(8, road.lanes ?? 1)));
  if (!lane?.points?.length) return null;
  return interpolate(lane.points, Math.max(0, Math.min(lane.lengthMeters, progressMeters)));
}

function trackLocation(
  track: RouteReplayVehicleTrack,
  timestampMs: number,
  activeRoute: Location[],
  activeLength: number,
  scene: SceneContext | null | undefined,
): Location {
  const start = track.startMs ?? 0;
  const progress = Math.max(0, Math.min(activeLength, track.startProgressMeters + track.speedMps * Math.max(0, timestampMs - start) / 1000));
  const lane = activeTrackLane(track, timestampMs);
  if (scene?.roads?.length) {
    const road = track.wayId != null ? scene.roads.find((r) => r.osm_id === track.wayId) : sceneRoadForRoute(scene, activeRoute, progress);
    if (road) {
      const lanePoint = pointAlongRoadLane(road, lane, progress);
      if (lanePoint) return lanePoint;
    }
  }
  return interpolate(activeRoute, progress);
}

function activeTrackLane(track: RouteReplayVehicleTrack, timestampMs: number): number {
  let lane = track.laneIndex;
  for (const change of [...(track.laneChanges ?? [])].sort((a, b) => a.atMs - b.atMs)) {
    if (timestampMs >= change.atMs) lane = change.laneIndex;
  }
  return lane;
}

function routeLength(route: Location[]): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) total += haversineDistanceMeters(route[i], route[i + 1]);
  return total;
}

function interpolate(route: Location[], distance: number): Location {
  if (!route.length) return { lat: 0, lng: 0 };
  let remaining = Math.max(0, distance);
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    const segment = haversineDistanceMeters(a, b);
    if (remaining <= segment || i === route.length - 2) {
      const t = segment > 0 ? Math.min(1, remaining / segment) : 0;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    remaining -= segment;
  }
  return route[route.length - 1];
}

function bearing(a: Location, b: Location): number {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function inWindow(timestampMs: number, start: number, end: number): boolean {
  return timestampMs >= start && timestampMs < end;
}

function inDropout(timestampMs: number, windows: RouteReplayConfig['gpsDropoutWindowsMs']): boolean {
  return (windows ?? []).some((w) => inWindow(timestampMs, w.start, w.end));
}

function blockerObservation(id: string, location: Location, timestampMs: number, laneIndex: number): LaneOccupantObservation {
  return { id, location, laneIndex, speedMps: 7, headingDegrees: 90, observedAtMs: timestampMs, confidence: 0.95 };
}

function closedLaneReport(location: Location): Report {
  return {
    id: 'route-replay-closed-lane', type: 'closed_lane', location, photo_url: null,
    reported_at: new Date(0).toISOString(), expires_at: new Date(86400000).toISOString(),
    reporter_id: 'simulation', confirmations: 1, dismissals: 0, confidence: 0.95,
  };
}

function activeEngine(route: Location[]): NavigationEngine {
  const engine = new NavigationEngine({ now: () => 0 });
  engine.setRoute(routeForSimulation(route));
  engine.dispatch({ type: 'PLAN', hasRoute: true });
  engine.dispatch({ type: 'START', hasRoute: true });
  return engine;
}

/**
 * Route-wide deterministic replay. Maneuvers remain sequential and can cross
 * synthetic junction boundaries; a missed maneuver can replace the route and
 * the replay continues rather than resetting the navigation session.
 */
export function replayRoute(config: RouteReplayConfig): RouteReplayResult {
  const stepMs = Math.max(100, config.stepMs ?? 400);
  const speedMps = Math.max(1, config.speedMps ?? 12);
  let activeRoute = config.route;
  let activeLength = routeLength(activeRoute);
  const engine = activeEngine(activeRoute);
  const resolved = config.maneuvers.map((m) => ({ ...m, distanceMeters: Math.min(activeLength, resolveManeuverDistance(config.route, m)) }));
  const sorted = [...resolved].sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  const initialDurationMs = Math.ceil((activeLength + 40) / speedMps * 1000);
  const replacementDurationMs = config.replacementRoute?.length ? Math.ceil((routeLength(config.replacementRoute) + 40) / speedMps * 1000) : 0;
  const durationMs = initialDurationMs + replacementDurationMs;
  const frames: RouteReplayFrame[] = [];
  const maneuverCompletions: string[] = [];
  const missedManeuvers: string[] = [];
  const resolvedManeuverDistances: Record<string, number> = {};
  for (const m of sorted) resolvedManeuverDistances[m.id] = m.distanceMeters ?? 0;
  let currentLane = sorted[0]?.sourceLane ?? 0;
  let activeIndex = 0;
  let rerouteCount = 0;
  let replacementRouteUsed = false;
  let maxActiveVehicles = 0;
  let junctionFrames = 0;
  let lastProgress = -Infinity;
  let activeRouteOffsetMs = 0;
  let junctionResolution: ComplexJunctionResolution | null = null;

  for (let elapsed = 0; elapsed <= durationMs; elapsed += stepMs) {
    const timestampMs = elapsed;
    const routeElapsedMs = Math.max(0, elapsed - activeRouteOffsetMs);
    const traveled = Math.min(activeLength, speedMps * routeElapsedMs / 1000);
    const truth = interpolate(activeRoute, traveled);
    const next = interpolate(activeRoute, Math.min(activeLength, traveled + Math.max(2, speedMps * 0.5)));
    const gpsDropout = inDropout(timestampMs - activeRouteOffsetMs, config.gpsDropoutWindowsMs);
    const fix = gpsDropout
      ? engine.tickContinuity(timestampMs)
      : engine.acceptGpsFix({ location: truth, timestampMs, accuracyMeters: 5, speedMps, headingDegrees: bearing(truth, next), motion: { timestampMs, speedMps, headingDegrees: bearing(truth, next), accelerationMps2: 0 } });
    const snapshot = engine.snapshot();
    const drive: SimulationSample = {
      timestampMs, truth, engineLocation: fix.location, progressMeters: Math.max(lastProgress, snapshot.matched?.progressMeters ?? -Infinity),
      truthProgressMeters: traveled, accepted: fix.accepted, usedContinuity: gpsDropout && fix.accepted, health: fix.health,
      speedMps: fix.speedMps, motionConfidence: fix.motionConfidence ?? 0,
    };
    lastProgress = Math.max(lastProgress, drive.progressMeters);

    const maneuver = sorted[activeIndex] ?? null;
    const distanceToManeuver = maneuver ? Math.max(0, (maneuver.distanceMeters ?? 0) - traveled) : null;
    if (maneuver?.junction) junctionFrames += 1;

    if (!maneuver) {
      const decision = decideUnifiedManeuver({ timing: null, reachability: null, currentLaneConfidence: 0.9, distanceToManeuverMeters: 999 });
      const execution = engine.updateLaneChangeExecution({ currentLaneIndex: currentLane, currentLaneConfidence: 0.9, timing: null, nowMs: timestampMs });
      frames.push({ timestampMs, truthProgressMeters: traveled, distanceToManeuverMeters: null, activeManeuverId: null, decision, execution, timing: null, dynamics: null, reachability: null, trafficSafe: true, trafficReason: null, activeVehicles: 0, gpsDropout, drive, rerouted: false, routeGeneration: snapshot.routeGeneration, junctionResolution });
      continue;
    }

    const maneuverDistance = distanceToManeuver ?? 0;
    const liveRoad = sceneRoadForRoute(config.scene, activeRoute, traveled) ?? sceneRoadForRoute(config.scene, activeRoute, maneuver.distanceMeters ?? traveled);
    const routeRoadModel = liveRoad ?? routeRoad(activeRoute, 9000 + activeIndex);
    const physicalTopology = maneuver.junction && config.scene
      ? buildPhysicalLaneTopology(config.scene.roads, { type: 'merge', modifier: null, location: truth, bearing_before: bearing(truth, next), instruction: maneuver.id, is_complex: true }, maneuver.targetLane, config.scene.restrictions, [])
      : null;
    const physicalConnector = physicalTopology?.connectors.find((connector) => connector.toLane === maneuver.targetLane) ?? null;
    const trajectory = physicalConnector
      ? { sourceLane: maneuver.sourceLane, targetLane: maneuver.targetLane, points: physicalConnector.points, lengthMeters: physicalConnector.geometryLengthMeters ?? 0, lateralShiftMeters: Math.abs(maneuver.targetLane - maneuver.sourceLane) * 3.6, startFraction: 0, endFraction: 1, confidence: physicalConnector.confidence, reachable: true, reason: 'physical' as const }
      : buildLaneChangeTrajectory(routeRoadModel, maneuver.sourceLane, maneuver.targetLane, Math.max(40, Math.min(56, 40 + Math.abs(maneuver.targetLane - maneuver.sourceLane) * 8)));
    const targetBlockers = (config.blockerWindows ?? []).filter((w) => w.maneuverId === maneuver.id && inWindow(timestampMs, w.startMs, w.endMs));
    const blockerPoint = trajectory.points.length ? trajectory.points[Math.floor(trajectory.points.length / 2)] : truth;
    const occupants: LaneOccupantObservation[] = targetBlockers.map((w) => blockerObservation(w.vehicleId, blockerPoint, timestampMs, maneuver.targetLane));
    for (const track of config.vehicleTracks ?? []) {
      const start = track.startMs ?? 0;
      const end = track.endMs ?? durationMs + stepMs;
      if (timestampMs < start || timestampMs >= end) continue;
      occupants.push(blockerObservation(track.id, trackLocation(track, timestampMs, activeRoute, activeLength, config.scene), timestampMs, activeTrackLane(track, timestampMs)));
    }
    const reports = (config.closedLaneManeuverIds ?? []).includes(maneuver.id) ? [closedLaneReport(truth)] : [];
    maxActiveVehicles = Math.max(maxActiveVehicles, occupants.length);
    const timing: DestinationLaneTiming = buildDestinationLaneTiming(currentLane, maneuver.targetLane, maneuverDistance);
    const dynamics = assessLaneChangeDynamics({ trajectory, currentSpeedMps: speedMps, distanceToManeuverMeters: maneuverDistance });
    const traffic = assessLaneChangeTrafficSafety({ trajectory, targetLane: maneuver.targetLane, occupants, reports, nowMs: timestampMs });
    const confidence = gpsDropout ? Math.min(0.48, drive.health.confidence) : Math.max(0.72, drive.health.confidence);
    const reachability = assessLaneChangeReachability({ trajectory, distanceToManeuverMeters: maneuverDistance, currentLaneIndex: currentLane, currentLaneConfidence: confidence, speedMps, occupants, reports, nowMs: timestampMs });
    const decision = decideUnifiedManeuver({ timing, reachability, currentLaneConfidence: confidence, distanceToManeuverMeters: maneuverDistance });

    if (maneuver.junction && maneuver.distanceMeters != null && activeRoute.length >= 4) {
      const livePair = sceneRoadPairForJunction(config.scene, activeRoute, maneuver.distanceMeters);
      const routeCumulative = cumulativeRouteDistances(activeRoute);
      let junctionIndex = routeCumulative.findIndex((d) => d >= maneuver.distanceMeters!);
      if (junctionIndex < 1) junctionIndex = 1;
      if (junctionIndex >= activeRoute.length - 1) junctionIndex = activeRoute.length - 2;
      const pair = livePair ?? routeJunctionRoads(activeRoute, junctionIndex);
      const syntheticManeuver = { type: 'merge', modifier: null, location: truth, bearing_before: 0, instruction: maneuver.id, is_complex: true };
      const topology = livePair ? buildPhysicalLaneTopology(config.scene?.roads ?? [], syntheticManeuver, maneuver.targetLane, config.scene?.restrictions, [pair.fromRoad.osm_id ?? 0]) : null;
      const continuity = livePair && pair.fromRoad.osm_id != null && pair.toRoad.osm_id != null
        ? buildJunctionLaneContinuity([pair.fromRoad, pair.toRoad], [pair.fromRoad.osm_id, pair.toRoad.osm_id], [syntheticManeuver], config.scene?.restrictions ?? [])
            .find((mapping) => mapping.fromLane === currentLane && mapping.legal)
        : null;
      const resolvedTarget = continuity?.toLane ?? topology?.connectors.find((connector) => connector.toLane === maneuver.targetLane)?.toLane ?? maneuver.targetLane;
      junctionResolution = resolveComplexJunctionLane(pair.fromRoad, pair.toRoad, syntheticManeuver, currentLane, resolvedTarget, config.scene?.restrictions ?? [], [pair.fromRoad.osm_id ?? 0], 60);
    } else {
      junctionResolution = null;
    }

    if (decision.action === 'change-now' && reachability.reachable && !gpsDropout && traffic.safe) currentLane = maneuver.targetLane;

    const execution = engine.updateLaneChangeExecution({ currentLaneIndex: currentLane, currentLaneConfidence: confidence, timing, reachable: reachability.reachable, reachabilityConfidence: reachability.confidence, dynamicsConfidence: dynamics.confidence, recommendedSpeedMps: dynamics.recommendedSpeedMps, safetyReason: reachability.reachable ? null : reachability.reason, distanceToManeuverMeters: maneuverDistance, nowMs: timestampMs });
    let rerouted = false;
    if (execution.phase === 'completed' && !maneuverCompletions.includes(maneuver.id)) {
      maneuverCompletions.push(maneuver.id);
      activeIndex += 1;
      if (activeIndex < sorted.length) currentLane = sorted[activeIndex].sourceLane;
    } else if (execution.phase === 'missed' && !missedManeuvers.includes(maneuver.id)) {
      missedManeuvers.push(maneuver.id);
      if (config.rerouteOnMiss !== false && engine.snapshot().state.phase === 'navigating') {
        engine.dispatch({ type: 'REROUTE' });
        if (config.replacementRoute?.length) {
          activeRoute = config.replacementRoute;
          activeLength = routeLength(activeRoute);
          activeRouteOffsetMs = timestampMs;
          engine.setRoute(routeForSimulation(activeRoute));
          replacementRouteUsed = true;
        }
        engine.dispatch({ type: 'REROUTE_SUCCEEDED' });
        rerouteCount += 1;
        rerouted = true;
        activeIndex += 1;
        lastProgress = -Infinity;
      }
    }

    frames.push({ timestampMs, truthProgressMeters: traveled, distanceToManeuverMeters: distanceToManeuver, activeManeuverId: maneuver.id, decision, execution, timing, dynamics, reachability, trafficSafe: traffic.safe, trafficReason: traffic.reason, activeVehicles: occupants.length, gpsDropout, drive, rerouted, routeGeneration: engine.snapshot().routeGeneration, junctionResolution });
  }

  const failures: string[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1];
    const current = frames[i];
    if (previous.routeGeneration === current.routeGeneration && current.drive.accepted && current.drive.progressMeters + 1 < previous.drive.progressMeters) {
      failures.push('route replay progress regressed');
      break;
    }
  }
  for (const maneuver of sorted) {
    const completed = maneuverCompletions.includes(maneuver.id);
    const missed = missedManeuvers.includes(maneuver.id);
    if (!completed && !missed) failures.push(`maneuver ${maneuver.id} never reached a terminal state`);
  }
  if (config.blockerWindows?.length && !frames.some((f) => f.activeVehicles > 0 && f.execution.phase === 'uncertain')) failures.push('traffic blocker did not create uncertainty');
  if (config.vehicleTracks?.length && !frames.some((f) => f.activeVehicles > 0)) failures.push('persistent vehicle track never became observable');
  if (config.gpsDropoutWindowsMs?.length && !frames.some((f) => f.gpsDropout && f.drive.usedContinuity)) failures.push('route replay dropout did not use continuity');
  if (config.replacementRoute?.length && missedManeuvers.length && !replacementRouteUsed) failures.push('missed maneuver did not use replacement route');
  if (config.replacementRoute?.length && replacementRouteUsed && !frames.some((f) => f.rerouted && f.routeGeneration > 1)) failures.push('reroute did not advance route generation');

  return { frames, completed: missedManeuvers.length === 0 && maneuverCompletions.length === sorted.length, maneuverCompletions, missedManeuvers, junctionFrames, rerouteCount, replacementRouteUsed, maxActiveVehicles, failures, resolvedManeuverDistances };
}

