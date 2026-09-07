import { Location, TrafficVehicle } from '../types';
import { destinationPoint, haversineDistanceMeters } from '../utils/geo';

export interface TrafficTrackState {
  id: string;
  previousLocation: Location;
  targetLocation: Location;
  previousHeadingDegrees: number;
  targetHeadingDegrees: number;
  previousObservedAtMs: number;
  targetObservedAtMs: number;
  speedMps: number;
  confidence: number;
  laneSnapped: boolean;
}

export interface TrafficSample {
  id: string;
  location: Location;
  headingDegrees: number;
  confidence: number;
  laneSnapped: boolean;
}

const MAX_TELEPORT_METERS = 140;
const MAX_EXTRAPOLATION_MS = 1800;
const MAX_CONFIDENCE_DECAY_MS = 6000;

const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;
const lerpAngle = (a: number, b: number, t: number) => {
  const delta = ((b - a + 540) % 360) - 180;
  return normalizeAngle(a + delta * t);
};

/** Keeps telemetry smooth between packets without accepting implausible jumps. */
export class TrafficInterpolator {
  private readonly tracks = new Map<string, TrafficTrackState>();

  update(vehicle: TrafficVehicle, location: Location, headingDegrees: number, laneSnapped: boolean, nowMs = Date.now()): void {
    const observedAtMs = Date.parse(vehicle.observed_at);
    if (!Number.isFinite(observedAtMs)) return;
    const previous = this.tracks.get(vehicle.id);
    if (previous && observedAtMs < previous.targetObservedAtMs) return;

    if (previous) {
      const jump = haversineDistanceMeters(previous.targetLocation, location);
      if (jump > MAX_TELEPORT_METERS) return;
    }

    const speedMps = Number.isFinite(vehicle.speed_mps ?? NaN) ? Math.max(0, Math.min(80, vehicle.speed_mps as number)) : 0;
    const fallbackTime = Math.max(1, observedAtMs - (previous?.targetObservedAtMs ?? observedAtMs - 1000));
    const startLocation = previous?.targetLocation ?? location;
    const startHeading = previous?.targetHeadingDegrees ?? headingDegrees;
    this.tracks.set(vehicle.id, {
      id: vehicle.id,
      previousLocation: startLocation,
      targetLocation: location,
      previousHeadingDegrees: startHeading,
      targetHeadingDegrees: normalizeAngle(headingDegrees),
      previousObservedAtMs: previous?.targetObservedAtMs ?? observedAtMs - fallbackTime,
      targetObservedAtMs: observedAtMs,
      speedMps,
      confidence: Math.max(0, Math.min(1, vehicle.confidence)),
      laneSnapped,
    });
    void nowMs;
  }

  sample(id: string, nowMs = Date.now()): TrafficSample | null {
    const track = this.tracks.get(id);
    if (!track) return null;
    const packetSpan = Math.max(1, track.targetObservedAtMs - track.previousObservedAtMs);
    const elapsed = nowMs - track.targetObservedAtMs;
    const interpolationT = elapsed < 0 ? Math.max(0, Math.min(1, (nowMs - track.previousObservedAtMs) / packetSpan)) : 1;
    let location = {
      lat: track.previousLocation.lat + (track.targetLocation.lat - track.previousLocation.lat) * interpolationT,
      lng: track.previousLocation.lng + (track.targetLocation.lng - track.previousLocation.lng) * interpolationT,
    };
    let heading = lerpAngle(track.previousHeadingDegrees, track.targetHeadingDegrees, interpolationT);

    if (elapsed > 0 && elapsed <= MAX_EXTRAPOLATION_MS && track.speedMps > 0.5) {
      location = destinationPoint(track.targetLocation, track.targetHeadingDegrees, track.speedMps * elapsed / 1000);
      heading = track.targetHeadingDegrees;
    }

    const age = Math.max(0, nowMs - track.targetObservedAtMs);
    const confidence = track.confidence * Math.max(0, 1 - age / MAX_CONFIDENCE_DECAY_MS);
    return { id, location, headingDegrees: heading, confidence, laneSnapped: track.laneSnapped };
  }

  removeMissing(activeIds: Set<string>): void {
    for (const id of this.tracks.keys()) if (!activeIds.has(id)) this.tracks.delete(id);
  }

  clear(): void { this.tracks.clear(); }
}
