import { Location, Report } from '../types';
import { LaneChangeTrajectory } from './laneChangeTrajectory';

export interface LaneOccupantObservation {
  id: string;
  location: Location;
  laneIndex: number | null;
  speedMps?: number | null;
  headingDegrees?: number | null;
  observedAtMs?: number;
  confidence?: number;
}

export interface LaneChangeTrafficSafetyInput {
  trajectory: LaneChangeTrajectory | null;
  targetLane: number | null;
  reports?: Report[];
  occupants?: LaneOccupantObservation[];
  nowMs?: number;
  staleAfterMs?: number;
  cautionDistanceMeters?: number;
  egoSpeedMps?: number | null;
  egoHeadingDegrees?: number | null;
}

export interface LaneChangeTrafficSafety {
  safe: boolean;
  confidence: number;
  targetLaneBlocked: boolean;
  occupiedBy: string[];
  hazardReports: string[];
  gapMeters: number | null;
  gapAheadMeters: number | null;
  gapBehindMeters: number | null;
  timeToConflictSeconds: number | null;
  reason: 'same-lane' | 'no-trajectory' | 'target-lane-blocked' | 'unsafe-gap' | 'traffic-caution' | 'safe';
}

function distanceMeters(a: Location, b: Location): number {
  const lat = (a.lat + b.lat) * 0.5 * Math.PI / 180;
  return Math.hypot((b.lat - a.lat) * 110540, (b.lng - a.lng) * 111320 * Math.max(0.2, Math.cos(lat)));
}

function projectAlongTrajectory(location: Location, points: Location[]): { distanceMeters: number; alongMeters: number; bearingDegrees: number | null } {
  if (points.length < 2) return { distanceMeters: Infinity, alongMeters: 0, bearingDegrees: null };
  let best = Infinity;
  let bestAlong = 0;
  let bestBearing: number | null = null;
  let traversed = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const cosLat = Math.max(0.2, Math.cos(((a.lat + b.lat) * 0.5) * Math.PI / 180));
    const ax = a.lng * 111320 * cosLat;
    const ay = a.lat * 110540;
    const bx = b.lng * 111320 * cosLat;
    const by = b.lat * 110540;
    const px = location.lng * 111320 * cosLat;
    const py = location.lat * 110540;
    const dx = bx - ax;
    const dy = by - ay;
    const segmentLength = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / Math.max(0.001, dx * dx + dy * dy)));
    const qx = ax + dx * t;
    const qy = ay + dy * t;
    const distance = Math.hypot(px - qx, py - qy);
    if (distance < best) {
      best = distance;
      bestAlong = traversed + segmentLength * t;
      bestBearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    }
    traversed += segmentLength;
  }
  return { distanceMeters: best, alongMeters: bestAlong, bearingDegrees: bestBearing };
}

function angleDeltaDegrees(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

function minDistanceToTrajectory(location: Location, points: Location[]): number {
  if (!points.length) return Infinity;
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const cosLat = Math.max(0.2, Math.cos(((a.lat + b.lat) * 0.5) * Math.PI / 180));
    const ax = a.lng * 111320 * cosLat;
    const ay = a.lat * 110540;
    const bx = b.lng * 111320 * cosLat;
    const by = b.lat * 110540;
    const px = location.lng * 111320 * cosLat;
    const py = location.lat * 110540;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / Math.max(0.001, dx * dx + dy * dy)));
    const q = { lat: (ay + dy * t) / 110540, lng: (ax + dx * t) / (111320 * cosLat) };
    best = Math.min(best, distanceMeters(location, q));
  }
  return best;
}

/**
 * Conservative cooperative lane-change gate. Real vehicle occupancy is optional
 * because the current backend does not yet stream lane-positioned vehicles. When
 * observations exist, they are treated as authoritative only while fresh and
 * confident. Community closed-lane/accident/construction reports near the target
 * trajectory add a caution/blocking signal rather than pretending they identify a
 * specific vehicle.
 */
export function assessLaneChangeTrafficSafety(input: LaneChangeTrafficSafetyInput): LaneChangeTrafficSafety {
  if (!input.trajectory || input.trajectory.sourceLane === input.trajectory.targetLane) {
    return { safe: true, confidence: input.trajectory ? 1 : 0, targetLaneBlocked: false, occupiedBy: [], hazardReports: [], gapMeters: null, gapAheadMeters: null, gapBehindMeters: null, timeToConflictSeconds: null, reason: input.trajectory ? 'same-lane' : 'no-trajectory' };
  }
  const targetLane = input.targetLane;
  if (targetLane == null) return { safe: false, confidence: 0, targetLaneBlocked: false, occupiedBy: [], hazardReports: [], gapMeters: null, gapAheadMeters: null, gapBehindMeters: null, timeToConflictSeconds: null, reason: 'unsafe-gap' };
  const now = input.nowMs ?? Date.now();
  const staleAfter = input.staleAfterMs ?? 5000;
  const cautionDistance = input.cautionDistanceMeters ?? 14;
  const freshOccupants = (input.occupants ?? []).filter((o) => now - (o.observedAtMs ?? now) <= staleAfter && (o.confidence ?? 1) >= 0.55 && o.laneIndex === targetLane);
  const occupiedBy: string[] = [];
  let nearestGap = Infinity;
  let gapAhead = Infinity;
  let gapBehind = Infinity;
  let blockerConfidence = 0;
  let nearestLongitudinalGap = Infinity;
  let nearestTimeToConflict = Infinity;
  const trajectoryLength = input.trajectory.lengthMeters || 0;
  const midpoint = trajectoryLength * 0.5;
  for (const occupant of freshOccupants) {
    const projected = projectAlongTrajectory(occupant.location, input.trajectory.points);
    if (projected.distanceMeters <= cautionDistance) {
      occupiedBy.push(occupant.id);
      blockerConfidence = Math.max(blockerConfidence, occupant.confidence ?? 1);
      nearestGap = Math.min(nearestGap, projected.distanceMeters);
      // A lane change needs longitudinal room as well as lateral clearance.
      // Treat the center of the change trajectory as the merge point and keep
      // conservative front/rear gaps instead of using only 2-D distance.
      const longitudinalGap = Math.abs(projected.alongMeters - midpoint);
      nearestLongitudinalGap = Math.min(nearestLongitudinalGap, longitudinalGap);
      // gapAhead/gapBehind describe where the observed vehicle sits relative
      // to the start of the lane-change corridor; the safety gate below still
      // evaluates the stricter merge-point gap. This keeps diagnostics useful
      // even when a vehicle is just before the midpoint.
      if (projected.alongMeters >= 0) gapAhead = Math.min(gapAhead, projected.alongMeters);
      if (projected.alongMeters < 0) gapBehind = Math.min(gapBehind, Math.abs(projected.alongMeters));

      // If both speeds/headings are available, predict the occupant through the
      // entire lane-change trajectory. A single merge-point check can miss a
      // vehicle that reaches the ego path earlier or later during the maneuver.
      const occupantSpeed = occupant.speedMps;
      const egoSpeed = input.egoSpeedMps;
      const trajectoryBearing = projected.bearingDegrees;
      const occupantHeading = occupant.headingDegrees;
      if (occupantSpeed != null && Number.isFinite(occupantSpeed) && egoSpeed != null && Number.isFinite(egoSpeed) && trajectoryBearing != null && occupantHeading != null && Number.isFinite(occupantHeading)) {
        const headingDelta = angleDeltaDegrees(occupantHeading, trajectoryBearing);
        if (headingDelta <= 75) {
          const occupantAlongSpeed = occupantSpeed * Math.cos(headingDelta * Math.PI / 180);
          const egoAlongSpeed = Math.max(2, egoSpeed);
          const maneuverSeconds = Math.max(1.5, trajectoryLength / egoAlongSpeed);
          const samples = 12;
          const longitudinalBuffer = 8;
          for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex += 1) {
            const time = maneuverSeconds * (sampleIndex / samples);
            const egoAlong = trajectoryLength * (sampleIndex / samples);
            const predictedOccupantAlong = projected.alongMeters + occupantAlongSpeed * time;
            const separation = Math.abs(predictedOccupantAlong - egoAlong);
            if (separation <= longitudinalBuffer) {
              nearestTimeToConflict = Math.min(nearestTimeToConflict, time);
              break;
            }
          }

          // Keep the direct closing-time estimate too; it catches a vehicle
          // approaching the maneuver before the sampled trajectory begins.
          const closingSpeed = projected.alongMeters >= midpoint
            ? egoAlongSpeed - occupantAlongSpeed
            : occupantAlongSpeed - egoAlongSpeed;
          if (closingSpeed > 0.25 && longitudinalGap > 0) {
            nearestTimeToConflict = Math.min(nearestTimeToConflict, longitudinalGap / closingSpeed);
          }
        } else if (headingDelta >= 120) {
          // Opposing-direction traffic in the target lane is treated as an
          // immediate conflict when the observation is close enough to matter.
          nearestTimeToConflict = Math.min(nearestTimeToConflict, 0);
        }
      }
    }
  }
  const minimumAheadGap = 10;
  const minimumBehindGap = 8;
  const unsafeLongitudinalGap = nearestLongitudinalGap < Math.max(minimumAheadGap, minimumBehindGap);
  const unsafePredictedConflict = nearestTimeToConflict < 3.5;
  const unsafeTrafficGap = unsafeLongitudinalGap || unsafePredictedConflict;

  const hazardReports = (input.reports ?? [])
    .filter((r) => r.type === 'closed_lane' || r.type === 'accident' || r.type === 'construction')
    .filter((r) => minDistanceToTrajectory(r.location, input.trajectory!.points) <= cautionDistance)
    .map((r) => r.type);

  if (occupiedBy.length && unsafeTrafficGap) {
    return { safe: false, confidence: Math.max(0.2, 1 - blockerConfidence * 0.75), targetLaneBlocked: true, occupiedBy, hazardReports, gapMeters: nearestGap, gapAheadMeters: Number.isFinite(gapAhead) ? gapAhead : null, gapBehindMeters: Number.isFinite(gapBehind) ? gapBehind : null, timeToConflictSeconds: Number.isFinite(nearestTimeToConflict) ? nearestTimeToConflict : null, reason: 'unsafe-gap' };
  }
  if (occupiedBy.length) {
    return { safe: true, confidence: 0.68, targetLaneBlocked: false, occupiedBy, hazardReports, gapMeters: nearestGap, gapAheadMeters: Number.isFinite(gapAhead) ? gapAhead : null, gapBehindMeters: Number.isFinite(gapBehind) ? gapBehind : null, timeToConflictSeconds: Number.isFinite(nearestTimeToConflict) ? nearestTimeToConflict : null, reason: 'safe' };
  }
  if (hazardReports.includes('closed_lane')) {
    return { safe: false, confidence: 0.2, targetLaneBlocked: true, occupiedBy, hazardReports, gapMeters: null, gapAheadMeters: null, gapBehindMeters: null, timeToConflictSeconds: null, reason: 'target-lane-blocked' };
  }
  if (hazardReports.length) {
    return { safe: true, confidence: 0.58, targetLaneBlocked: false, occupiedBy, hazardReports, gapMeters: null, gapAheadMeters: null, gapBehindMeters: null, timeToConflictSeconds: null, reason: 'traffic-caution' };
  }
  return { safe: true, confidence: 0.9, targetLaneBlocked: false, occupiedBy, hazardReports, gapMeters: null, gapAheadMeters: null, gapBehindMeters: null, timeToConflictSeconds: null, reason: 'safe' };
}
