import { Location } from '../types';

export interface MotionSensorSample {
  timestampMs: number;
  speedMps?: number | null;
  headingDegrees?: number | null;
  accelerationMps2?: number | null;
}

export interface FusedMotionState {
  speedMps: number | null;
  headingDegrees: number | null;
  accelerationMps2: number | null;
  confidence: number;
  source: 'gps' | 'motion' | 'fused' | 'none';
}

export interface SensorFusionInput {
  location: Location;
  previousLocation: Location | null;
  previousTimestampMs: number | null;
  timestampMs: number;
  gpsSpeedMps?: number | null;
  gpsHeadingDegrees?: number | null;
  gpsAccuracyMeters?: number | null;
  motion?: MotionSensorSample | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function angleDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360;
}

function derivedSpeed(input: SensorFusionInput): number | null {
  if (!input.previousLocation || input.previousTimestampMs == null) return null;
  const dt = input.previousTimestampMs != null
    ? input.timestampMs - input.previousTimestampMs
    : 0;
  if (dt <= 200) return null;
  const dLat = (input.location.lat - input.previousLocation.lat) * 110540;
  const dLng = (input.location.lng - input.previousLocation.lng) * 111320 * Math.max(0.2, Math.cos(input.location.lat * Math.PI / 180));
  return clamp(Math.hypot(dLat, dLng) / (dt / 1000), 0, 55);
}

/**
 * Lightweight browser-safe motion fusion. It combines GPS speed/heading with
 * optional device motion readings, rejects obviously stale/outlier samples,
 * and exposes a confidence value. It is deliberately not an INS/Kalman filter:
 * it provides a stable navigation estimate without pretending to calibrate
 * arbitrary phone IMUs.
 */
export function fuseMotion(input: SensorFusionInput): FusedMotionState {
  const gpsSpeed = input.gpsSpeedMps != null && Number.isFinite(input.gpsSpeedMps) && input.gpsSpeedMps >= 0
    ? clamp(input.gpsSpeedMps, 0, 55) : null;
  const gpsHeading = input.gpsHeadingDegrees != null && Number.isFinite(input.gpsHeadingDegrees)
    ? normalizeHeading(input.gpsHeadingDegrees) : null;
  const derived = derivedSpeed(input);
  const motion = input.motion;
  const motionFresh = !!motion && Number.isFinite(motion.timestampMs)
    && Math.abs(motion.timestampMs - (input.previousTimestampMs ?? motion.timestampMs)) <= 5000;
  const motionSpeed = motionFresh && motion?.speedMps != null && Number.isFinite(motion.speedMps) && motion.speedMps >= 0
    ? clamp(motion.speedMps, 0, 55) : null;
  const motionHeading = motionFresh && motion?.headingDegrees != null && Number.isFinite(motion.headingDegrees)
    ? normalizeHeading(motion.headingDegrees) : null;
  const acceleration = motionFresh && motion?.accelerationMps2 != null && Number.isFinite(motion.accelerationMps2)
    ? clamp(motion.accelerationMps2, -12, 12) : null;

  let speed: number | null = null;
  let speedSource: 'gps' | 'motion' | 'fused' | 'none' = 'none';
  if (gpsSpeed != null && motionSpeed != null) {
    const agreement = Math.abs(gpsSpeed - motionSpeed);
    if (agreement <= 4) {
      speed = gpsSpeed * 0.65 + motionSpeed * 0.35;
      speedSource = 'fused';
    } else if (input.gpsAccuracyMeters != null && input.gpsAccuracyMeters > 18) {
      speed = motionSpeed;
      speedSource = 'motion';
    } else {
      speed = gpsSpeed * 0.8 + motionSpeed * 0.2;
      speedSource = 'fused';
    }
  } else if (gpsSpeed != null) {
    speed = gpsSpeed;
    speedSource = 'gps';
  } else if (motionSpeed != null) {
    speed = motionSpeed;
    speedSource = 'motion';
  } else if (derived != null) {
    speed = derived;
    speedSource = 'gps';
  }

  let heading: number | null = null;
  if (gpsHeading != null && motionHeading != null) {
    const disagreement = angleDelta(gpsHeading, motionHeading);
    heading = disagreement <= 35
      ? normalizeHeading(gpsHeading + ((motionHeading - gpsHeading + 540) % 360 - 180) * 0.35)
      : (input.gpsAccuracyMeters != null && input.gpsAccuracyMeters > 18 ? motionHeading : gpsHeading);
    if (speed != null && speed < 1.2) heading = gpsHeading;
  } else {
    heading = gpsHeading ?? motionHeading;
  }

  const accuracyConfidence = input.gpsAccuracyMeters == null
    ? 0.55 : clamp(1 - Math.max(0, input.gpsAccuracyMeters - 4) / 36, 0.25, 1);
  const speedAgreementConfidence = gpsSpeed != null && motionSpeed != null
    ? clamp(1 - Math.abs(gpsSpeed - motionSpeed) / 12, 0.25, 1) : 0.72;
  const headingAgreementConfidence = gpsHeading != null && motionHeading != null
    ? clamp(1 - angleDelta(gpsHeading, motionHeading) / 120, 0.3, 1) : 0.72;
  const confidence = clamp(accuracyConfidence * 0.55 + speedAgreementConfidence * 0.25 + headingAgreementConfidence * 0.2, 0.2, 0.98);

  return { speedMps: speed, headingDegrees: heading, accelerationMps2: acceleration, confidence, source: speedSource };
}
