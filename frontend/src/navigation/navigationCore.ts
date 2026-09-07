import { Location } from '../types';
import { haversineDistanceMeters, projectOntoPolyline } from '../utils/geo';

export type { NavigationPhase } from './navigationState';
export interface NavigationRouteIndex {
  polyline: Location[];
  cumulativeMeters: number[];
  segmentLengthsMeters: number[];
}

export interface MatchedPosition {
  location: Location;
  rawLocation: Location;
  progressMeters: number;
  lateralMeters: number;
  confidence: number;
  onRoute: boolean;
  segmentIndex: number;
}


export interface NavigationHealth {
  gps: 'good' | 'weak' | 'lost';
  route: 'on-route' | 'uncertain' | 'off-route';
  confidence: number;
  staleMs: number | null;
}

export function deriveNavigationHealth(
  matched: MatchedPosition | null,
  gpsLastUpdateMs: number | null,
  nowMs = Date.now(),
): NavigationHealth {
  const staleMs = gpsLastUpdateMs == null ? null : Math.max(0, nowMs - gpsLastUpdateMs);
  const gps: NavigationHealth['gps'] = staleMs == null || staleMs > 8000 ? 'lost' : staleMs > 3000 ? 'weak' : 'good';
  const confidence = matched?.confidence ?? 0;
  const route = matched?.onRoute ? 'on-route' : confidence >= 0.3 ? 'uncertain' : 'off-route';
  return { gps, route, confidence, staleMs };
}

export interface NavigationProgress {
  distanceRemainingMeters: number | null;
  destinationDistanceMeters: number | null;
  offRoute: boolean;
  arrived: boolean;
}

export function buildNavigationRouteIndex(polyline: Location[]): NavigationRouteIndex {
  const cumulativeMeters = [0];
  const segmentLengthsMeters: number[] = [];
  for (let i = 0; i < Math.max(0, polyline.length - 1); i += 1) {
    const length = haversineDistanceMeters(polyline[i], polyline[i + 1]);
    segmentLengthsMeters.push(length);
    cumulativeMeters.push(cumulativeMeters[i] + length);
  }
  return { polyline, cumulativeMeters, segmentLengthsMeters };
}

export function projectOntoPolylineNear(
  point: Location,
  polyline: Location[],
  centerSegmentIndex: number | null,
  windowSegments = 24,
  routeIndex: NavigationRouteIndex | null = null,
) {
  if (polyline.length < 2) return null;
  if (centerSegmentIndex == null) return projectOntoPolyline(point, polyline);
  const index = routeIndex ?? buildNavigationRouteIndex(polyline);
  const start = Math.max(0, centerSegmentIndex - windowSegments);
  const end = Math.min(polyline.length - 2, centerSegmentIndex + windowSegments);
  const origin = polyline[0];
  const latRad = origin.lat * Math.PI / 180;
  const toLocal = (p: Location) => ({
    x: (p.lng - origin.lng) * Math.cos(latRad) * 111320,
    y: (p.lat - origin.lat) * 110540,
  });
  const p = toLocal(point);
  let best: { distanceAlongMeters: number; distanceFromLineMeters: number; segmentIndex: number } | null = null;
  let bestLateral = Infinity;
  for (let i = start; i <= end; i += 1) {
    const a = toLocal(polyline[i]); const b = toLocal(polyline[i + 1]);
    const abx = b.x - a.x; const aby = b.y - a.y; const len = Math.hypot(abx, aby);
    const t = len > 0 ? Math.max(0, Math.min(1, ((p.x-a.x)*abx + (p.y-a.y)*aby)/(len*len))) : 0;
    const dx = p.x - (a.x + t*abx); const dy = p.y - (a.y + t*aby);
    const lateral = Math.hypot(dx, dy);
    if (lateral < bestLateral) {
      bestLateral = lateral;
      best = { distanceAlongMeters: index.cumulativeMeters[i] + t*len, distanceFromLineMeters: lateral, segmentIndex: i };
    }
  }
  return best && best.distanceFromLineMeters <= 150 ? best : projectOntoPolyline(point, polyline);
}

export function smoothLocation(previous: Location | null, next: Location, alpha = 0.42): Location {
  if (!previous) return next;
  return {
    lat: previous.lat + (next.lat - previous.lat) * alpha,
    lng: previous.lng + (next.lng - previous.lng) * alpha,
  };
}

export interface LocationFixQualityInput {
  previous: Location | null;
  next: Location;
  previousTimestampMs: number | null;
  timestampMs: number;
  accuracyMeters: number | null;
  reportedSpeedMps: number | null;
}

/** Reject fixes that are temporally stale or imply an implausible jump.
 * The thresholds intentionally scale with reported speed and GPS accuracy so
 * fast highway motion is allowed while noisy stationary fixes are rejected. */
export function isPlausibleLocationFix(input: LocationFixQualityInput): boolean {
  if (!Number.isFinite(input.next.lat) || !Number.isFinite(input.next.lng)) return false;
  if (input.previous == null || input.previousTimestampMs == null) return true;
  if (!Number.isFinite(input.timestampMs) || input.timestampMs + 1000 < input.previousTimestampMs) return false;

  const dtSeconds = Math.max(0.05, (input.timestampMs - input.previousTimestampMs) / 1000);
  const stepMeters = haversineDistanceMeters(input.previous, input.next);
  const speed = input.reportedSpeedMps != null && Number.isFinite(input.reportedSpeedMps) && input.reportedSpeedMps >= 0
    ? input.reportedSpeedMps
    : stepMeters / dtSeconds;
  const maxStepMeters = Math.max(
    90,
    speed * Math.max(1, dtSeconds) * 2.5 + (input.accuracyMeters ?? 25) * 1.5,
  );
  return stepMeters <= maxStepMeters;
}

function pointAtProgress(polyline: Location[], progressMeters: number, routeIndex: NavigationRouteIndex | null = null): Location | null {
  if (polyline.length < 2) return null;
  const index = routeIndex ?? buildNavigationRouteIndex(polyline);
  const target = Math.max(0, Math.min(index.cumulativeMeters[index.cumulativeMeters.length - 1], progressMeters));
  let lo = 0; let hi = index.cumulativeMeters.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (index.cumulativeMeters[mid] < target) lo = mid + 1; else hi = mid;
  }
  const i = Math.max(0, Math.min(polyline.length - 2, lo - (index.cumulativeMeters[lo] > target ? 1 : 0)));
  const start = index.cumulativeMeters[i];
  const len = index.segmentLengthsMeters[i];
  const t = len > 0 ? (target - start) / len : 0;
  return { lat: polyline[i].lat + (polyline[i + 1].lat - polyline[i].lat) * t, lng: polyline[i].lng + (polyline[i + 1].lng - polyline[i].lng) * t };
}

function angleDeltaDegrees(a: number, b: number): number {
  return Math.abs((((a - b) + 540) % 360) - 180);
}

function routeBearingAtProgress(polyline: Location[], progressMeters: number, routeIndex: NavigationRouteIndex | null = null): number | null {
  if (polyline.length < 2) return null;
  const index = routeIndex ?? buildNavigationRouteIndex(polyline);
  const target = Math.max(0, Math.min(index.cumulativeMeters[index.cumulativeMeters.length - 1], progressMeters));
  let lo = 0; let hi = index.cumulativeMeters.length - 1;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (index.cumulativeMeters[mid] < target) lo = mid + 1; else hi = mid; }
  const i = Math.max(0, Math.min(polyline.length - 2, lo - (index.cumulativeMeters[lo] > target ? 1 : 0)));
  const a = polyline[i]; const b = polyline[i + 1];
  if (index.segmentLengthsMeters[i] <= 0) return null;
  const y = Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
  const x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180)
    - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Route-aware web map matching with heading-aware disambiguation. */
export function matchPosition(
  rawLocation: Location,
  polyline: Location[],
  previousProgressMeters: number | null = null,
  headingDegrees: number | null = null,
  previousSegmentIndex: number | null = null,
  routeIndex: NavigationRouteIndex | null = null,
  allowReverseProgress = false,
  windowSegments = 24,
): MatchedPosition {
  if (polyline.length < 2) {
    return { location: rawLocation, rawLocation, progressMeters: previousProgressMeters ?? 0, lateralMeters: Infinity, confidence: 0, onRoute: false, segmentIndex: 0 };
  }
  const projection = projectOntoPolylineNear(rawLocation, polyline, previousSegmentIndex, windowSegments, routeIndex);
  if (!projection) {
    return { location: rawLocation, rawLocation, progressMeters: previousProgressMeters ?? 0, lateralMeters: Infinity, confidence: 0, onRoute: false, segmentIndex: 0 };
  }

  // GPS noise can make the nearest point oscillate around an intersection.
  // Keep forward navigation monotonic. Explicit reverse navigation is handled
  // separately through allowReverseProgress so GPS noise cannot create fake
  // backwards progress.
  const progressMeters = previousProgressMeters == null
    ? projection.distanceAlongMeters
    : allowReverseProgress
      ? projection.distanceAlongMeters
      : Math.max(previousProgressMeters, projection.distanceAlongMeters);
  const snapped = pointAtProgress(polyline, progressMeters, routeIndex) ?? rawLocation;

  const lateralConfidence = Math.max(0, Math.min(1, 1 - projection.distanceFromLineMeters / 70));
  const routeBearing = routeBearingAtProgress(polyline, progressMeters, routeIndex);
  const headingConfidence = headingDegrees != null && routeBearing != null
    ? Math.max(0, Math.min(1, 1 - angleDeltaDegrees(headingDegrees, routeBearing) / 100))
    : 0.65;
  const confidence = lateralConfidence * 0.72 + headingConfidence * 0.28;
  const onRoute = projection.distanceFromLineMeters <= 65 && confidence >= 0.3;

  return {
    location: confidence >= 0.3 ? snapped : rawLocation,
    rawLocation,
    progressMeters,
    lateralMeters: projection.distanceFromLineMeters,
    confidence,
    onRoute,
    segmentIndex: projection.segmentIndex,
  };
}

export function getNavigationProgress(
  location: Location,
  routePolyline: Location[],
  destination: Location | null,
  routeDistanceMeters: number | null,
  arrivedRadiusMeters = 35,
): NavigationProgress {
  const projection = projectOntoPolyline(location, routePolyline);
  const destinationDistanceMeters = destination ? haversineDistanceMeters(location, destination) : null;
  const arrived = destinationDistanceMeters != null && destinationDistanceMeters <= arrivedRadiusMeters;
  const distanceRemainingMeters = projection && routeDistanceMeters != null
    ? Math.max(0, routeDistanceMeters - projection.distanceAlongMeters)
    : null;
  return {
    distanceRemainingMeters,
    destinationDistanceMeters,
    offRoute: projection ? projection.distanceFromLineMeters > 65 : true,
    arrived,
  };
}

export interface NavigationEta {
  remainingMeters: number | null;
  remainingSeconds: number | null;
  arrivalTimeMs: number | null;
}

/** Estimate remaining trip time from route progress without pretending that
 * the original route duration is still perfectly valid after a detour or
 * GPS correction. Uses a conservative speed floor and keeps a stable ETA at
 * very low speed instead of exploding toward Infinity. */
export function estimateNavigationEta(
  progressMeters: number | null,
  routeDistanceMeters: number | null,
  routeDurationSeconds: number | null,
  currentSpeedMps: number | null,
  nowMs = Date.now(),
): NavigationEta {
  if (progressMeters == null || routeDistanceMeters == null || routeDistanceMeters <= 0) {
    return { remainingMeters: null, remainingSeconds: null, arrivalTimeMs: null };
  }
  const remainingMeters = Math.max(0, routeDistanceMeters - progressMeters);
  if (remainingMeters <= 0) return { remainingMeters: 0, remainingSeconds: 0, arrivalTimeMs: nowMs };

  const progressRatio = Math.min(1, Math.max(0, progressMeters / routeDistanceMeters));
  const baselineRemaining = routeDurationSeconds != null
    ? Math.max(0, routeDurationSeconds * (1 - progressRatio))
    : null;
  const speedSeconds = currentSpeedMps != null && Number.isFinite(currentSpeedMps) && currentSpeedMps > 1.4
    ? remainingMeters / currentSpeedMps
    : null;

  let remainingSeconds = baselineRemaining;
  if (speedSeconds != null) {
    remainingSeconds = remainingSeconds == null
      ? speedSeconds
      : Math.max(speedSeconds * 0.9, Math.min(speedSeconds * 1.6, (baselineRemaining ?? speedSeconds) * 1.15));
  }

  const clampedSeconds = remainingSeconds != null
    ? Math.min(12 * 60 * 60, Math.max(0, remainingSeconds))
    : null;
  return {
    remainingMeters,
    remainingSeconds: clampedSeconds,
    arrivalTimeMs: clampedSeconds != null ? nowMs + clampedSeconds * 1000 : null,
  };
}
