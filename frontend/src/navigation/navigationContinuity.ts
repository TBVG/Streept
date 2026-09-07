import { Location } from '../types';
import { haversineDistanceMeters } from '../utils/geo';

export interface DeadReckoningState {
  location: Location;
  elapsedMs: number;
  confidence: number;
  distanceMeters: number;
}

export interface DeadReckoningInput {
  lastLocation: Location | null;
  lastFixTimestampMs: number | null;
  speedMps: number | null;
  headingDegrees: number | null;
  nowMs?: number;
  maxDurationMs?: number;
}

/**
 * Short-horizon inertial/dead-reckoning bridge for GPS dropouts. This is not
 * intended to replace sensor fusion; it keeps the navigation marker and
 * route-progress model moving through brief tunnels, parking structures and
 * urban-canyon gaps until a trustworthy GPS fix returns.
 */
export function estimateDeadReckonedLocation(input: DeadReckoningInput): DeadReckoningState | null {
  if (!input.lastLocation || input.lastFixTimestampMs == null) return null;
  if (input.speedMps == null || !Number.isFinite(input.speedMps) || input.speedMps < 0.5) return null;
  if (input.headingDegrees == null || !Number.isFinite(input.headingDegrees)) return null;

  const nowMs = input.nowMs ?? Date.now();
  const elapsedMs = Math.max(0, nowMs - input.lastFixTimestampMs);
  const maxDurationMs = input.maxDurationMs ?? 15000;
  if (elapsedMs < 250 || elapsedMs > maxDurationMs) return null;

  // Cap extrapolation speed so a stale browser speed reading cannot create a
  // highway-sized teleport after a long GPS outage.
  const speedMps = Math.min(input.speedMps, 45);
  const distanceMeters = speedMps * elapsedMs / 1000;
  const headingRad = input.headingDegrees * Math.PI / 180;
  const latScale = 110540;
  const lngScale = 111320 * Math.max(0.2, Math.cos(input.lastLocation.lat * Math.PI / 180));
  const northMeters = Math.cos(headingRad) * distanceMeters;
  const eastMeters = Math.sin(headingRad) * distanceMeters;
  const location = {
    lat: input.lastLocation.lat + northMeters / latScale,
    lng: input.lastLocation.lng + eastMeters / lngScale,
  };

  // Confidence fades quickly because this estimate has no fresh GPS anchor.
  const confidence = Math.max(0.05, 0.72 * Math.exp(-elapsedMs / 6500));
  return { location, elapsedMs, confidence, distanceMeters };
}

/** Whether a GPS gap is long enough to enter continuity mode. */
export function isGpsContinuityGap(lastFixTimestampMs: number | null, nowMs = Date.now(), thresholdMs = 3000): boolean {
  return lastFixTimestampMs != null && nowMs - lastFixTimestampMs >= thresholdMs;
}

/** Prevent a predicted point from being treated as a fresh GPS observation. */
export function continuityAccuracyMeters(elapsedMs: number): number {
  return Math.min(120, 25 + elapsedMs * 0.006);
}

export function continuityDistanceFromAnchor(anchor: Location | null, predicted: Location | null): number | null {
  if (!anchor || !predicted) return null;
  return haversineDistanceMeters(anchor, predicted);
}
