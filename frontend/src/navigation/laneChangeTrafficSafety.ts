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
}

export interface LaneChangeTrafficSafety {
  safe: boolean;
  confidence: number;
  targetLaneBlocked: boolean;
  occupiedBy: string[];
  hazardReports: string[];
  gapMeters: number | null;
  reason: 'same-lane' | 'no-trajectory' | 'target-lane-blocked' | 'unsafe-gap' | 'traffic-caution' | 'safe';
}

function distanceMeters(a: Location, b: Location): number {
  const lat = (a.lat + b.lat) * 0.5 * Math.PI / 180;
  return Math.hypot((b.lat - a.lat) * 110540, (b.lng - a.lng) * 111320 * Math.max(0.2, Math.cos(lat)));
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
    return { safe: true, confidence: input.trajectory ? 1 : 0, targetLaneBlocked: false, occupiedBy: [], hazardReports: [], gapMeters: null, reason: input.trajectory ? 'same-lane' : 'no-trajectory' };
  }
  const targetLane = input.targetLane;
  if (targetLane == null) return { safe: false, confidence: 0, targetLaneBlocked: false, occupiedBy: [], hazardReports: [], gapMeters: null, reason: 'unsafe-gap' };
  const now = input.nowMs ?? Date.now();
  const staleAfter = input.staleAfterMs ?? 5000;
  const cautionDistance = input.cautionDistanceMeters ?? 14;
  const freshOccupants = (input.occupants ?? []).filter((o) => now - (o.observedAtMs ?? now) <= staleAfter && (o.confidence ?? 1) >= 0.55 && o.laneIndex === targetLane);
  const occupiedBy: string[] = [];
  let nearestGap = Infinity;
  let blockerConfidence = 0;
  for (const occupant of freshOccupants) {
    const d = minDistanceToTrajectory(occupant.location, input.trajectory.points);
    if (d <= cautionDistance) {
      occupiedBy.push(occupant.id);
      blockerConfidence = Math.max(blockerConfidence, occupant.confidence ?? 1);
      nearestGap = Math.min(nearestGap, d);
    }
  }
  const hazardReports = (input.reports ?? [])
    .filter((r) => r.type === 'closed_lane' || r.type === 'accident' || r.type === 'construction')
    .filter((r) => minDistanceToTrajectory(r.location, input.trajectory!.points) <= cautionDistance)
    .map((r) => r.type);

  if (occupiedBy.length) {
    return { safe: false, confidence: Math.max(0.2, 1 - blockerConfidence * 0.75), targetLaneBlocked: true, occupiedBy, hazardReports, gapMeters: nearestGap, reason: 'unsafe-gap' };
  }
  if (hazardReports.includes('closed_lane')) {
    return { safe: false, confidence: 0.2, targetLaneBlocked: true, occupiedBy, hazardReports, gapMeters: null, reason: 'target-lane-blocked' };
  }
  if (hazardReports.length) {
    return { safe: true, confidence: 0.58, targetLaneBlocked: false, occupiedBy, hazardReports, gapMeters: null, reason: 'traffic-caution' };
  }
  return { safe: true, confidence: 0.9, targetLaneBlocked: false, occupiedBy, hazardReports, gapMeters: null, reason: 'safe' };
}
