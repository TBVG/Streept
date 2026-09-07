import { Location, Route3DHighlight, RouteCoord } from '../types';
import { haversineDistanceMeters } from '../utils/geo';
import { NavigationEngine, NavigationEngineSnapshot } from './navigationEngine';

export interface SimulationConfig {
  route: Location[];
  speedMps?: number;
  stepMs?: number;
  gpsAccuracyMeters?: number;
  gpsNoiseMeters?: number;
  dropoutWindowsMs?: Array<{ start: number; end: number }>;
  lateralNoiseMeters?: number;
  startTimestampMs?: number;
}

export interface SimulationSample {
  timestampMs: number;
  truth: Location;
  engineLocation: Location | null;
  progressMeters: number;
  truthProgressMeters: number;
  accepted: boolean;
  usedContinuity: boolean;
  health: NavigationEngineSnapshot['health'];
  speedMps: number | null;
  motionConfidence: number;
}

export interface SimulationResult {
  samples: SimulationSample[];
  acceptedFixes: number;
  continuitySamples: number;
  rejectedFixes: number;
  monotonicViolations: number;
  maxPositionErrorMeters: number;
  finalProgressMeters: number;
  routeLengthMeters: number;
  completed: boolean;
  finalHealth: NavigationEngineSnapshot['health'];
}

function bearingDegrees(a: Location, b: Location): number {
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function offsetMeters(location: Location, northMeters: number, eastMeters: number): Location {
  return {
    lat: location.lat + northMeters / 110540,
    lng: location.lng + eastMeters / (111320 * Math.max(0.2, Math.cos(location.lat * Math.PI / 180))),
  };
}

function interpolateRoute(route: Location[], distanceMeters: number): Location {
  if (!route.length) return { lat: 0, lng: 0 };
  if (route.length === 1 || distanceMeters <= 0) return route[0];
  let remaining = distanceMeters;
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    const length = haversineDistanceMeters(a, b);
    if (remaining <= length || i === route.length - 2) {
      const t = length > 0 ? Math.max(0, Math.min(1, remaining / length)) : 0;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    remaining -= length;
  }
  return route[route.length - 1];
}

function routeLength(route: Location[]): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) total += haversineDistanceMeters(route[i], route[i + 1]);
  return total;
}

function inDropout(timestampMs: number, windows: SimulationConfig['dropoutWindowsMs']): boolean {
  return (windows ?? []).some((window) => timestampMs >= window.start && timestampMs < window.end);
}

/**
 * Deterministic, renderer-independent drive simulation. It exercises the same
 * GPS acceptance, sensor fusion, route matching and short-horizon continuity
 * used by the live NavigationEngine, making regressions reproducible in tests.
 */
export function simulateNavigation(engine: NavigationEngine, config: SimulationConfig): SimulationResult {
  const stepMs = Math.max(100, config.stepMs ?? 500);
  const speedMps = Math.max(0.5, config.speedMps ?? 13.9);
  const accuracy = Math.max(1, config.gpsAccuracyMeters ?? 5);
  const noise = Math.max(0, config.gpsNoiseMeters ?? 0);
  const lateralNoise = Math.max(0, config.lateralNoiseMeters ?? 0);
  const start = config.startTimestampMs ?? 0;
  const length = routeLength(config.route);
  const durationMs = Math.ceil(length / speedMps * 1000);
  const samples: SimulationSample[] = [];
  let acceptedFixes = 0;
  let continuitySamples = 0;
  let rejectedFixes = 0;
  let monotonicViolations = 0;
  let maxPositionErrorMeters = 0;
  let previousProgress = -Infinity;

  for (let elapsed = 0; elapsed <= durationMs; elapsed += stepMs) {
    const timestampMs = start + elapsed;
    const truthProgressMeters = Math.min(length, speedMps * elapsed / 1000);
    const truth = interpolateRoute(config.route, truthProgressMeters);
    const nextTruth = interpolateRoute(config.route, Math.min(length, truthProgressMeters + Math.max(2, speedMps * 0.5)));
    const heading = bearingDegrees(truth, nextTruth);
    const dropout = inDropout(elapsed, config.dropoutWindowsMs);

    let result;
    let usedContinuity = false;
    if (dropout) {
      result = engine.tickContinuity(timestampMs);
      usedContinuity = result.accepted;
      if (usedContinuity) continuitySamples += 1;
      else rejectedFixes += 1;
    } else {
      // Fixed, deterministic offsets avoid flaky stochastic tests while still
      // exercising the real GPS plausibility and map-matching path.
      const phase = elapsed / Math.max(stepMs, 100);
      const north = noise * Math.sin(phase * 0.71) + lateralNoise * Math.sin(phase * 0.37);
      const east = noise * Math.cos(phase * 0.53) + lateralNoise * Math.cos(phase * 0.29);
      const observed = offsetMeters(truth, north, east);
      result = engine.acceptGpsFix({
        location: observed,
        timestampMs,
        accuracyMeters: accuracy,
        speedMps,
        headingDegrees: heading,
        motion: { timestampMs, speedMps, headingDegrees: heading, accelerationMps2: 0 },
      });
      if (result.accepted) acceptedFixes += 1;
      else rejectedFixes += 1;
    }

    const progress = result.matched?.progressMeters ?? previousProgress;
    if (Number.isFinite(previousProgress) && progress + 1 < previousProgress) monotonicViolations += 1;
    previousProgress = Math.max(previousProgress, progress);
    const error = result.location ? haversineDistanceMeters(truth, result.location) : Infinity;
    if (Number.isFinite(error)) maxPositionErrorMeters = Math.max(maxPositionErrorMeters, error);
    samples.push({
      timestampMs,
      truth,
      engineLocation: result.location,
      progressMeters: progress,
      truthProgressMeters,
      accepted: result.accepted,
      usedContinuity,
      health: result.health,
      speedMps: result.speedMps,
      motionConfidence: result.motionConfidence ?? 0,
    });
  }

  const final = engine.snapshot();
  return {
    samples,
    acceptedFixes,
    continuitySamples,
    rejectedFixes,
    monotonicViolations,
    maxPositionErrorMeters,
    finalProgressMeters: final.matched?.progressMeters ?? 0,
    routeLengthMeters: length,
    completed: final.matched != null && final.matched.progressMeters >= Math.max(0, length - 35),
    finalHealth: final.health,
  };
}

export function routeForSimulation(route: Location[]): Route3DHighlight {
  const coords: RouteCoord[] = route.map((point) => ({ ...point, alt: 0 }));
  return {
    segments: [{ coords, is_highlighted: true, color: '#00aaff', lane_index: null }],
    maneuvers: [],
    duration_seconds: null,
    distance_meters: routeLength(route),
  };
}
