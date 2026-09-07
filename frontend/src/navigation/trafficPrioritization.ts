import { Location } from '../types';
import { bearingDegrees, haversineDistanceMeters } from '../utils/geo';
import { Traffic3DRenderCandidate } from './liveTraffic3D';

export interface TrafficPriorityContext {
  userLocation: Location;
  userHeadingDegrees?: number | null;
  currentLaneIndex?: number | null;
  maneuverLocation?: Location | null;
}

export interface PrioritizedTrafficCandidate extends Traffic3DRenderCandidate {
  priority: number;
}

const angleDelta = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Scores nearby vehicles so the immersive renderer spends its budget where the driver looks. */
export function prioritizeTrafficCandidates(
  candidates: Traffic3DRenderCandidate[],
  context: TrafficPriorityContext,
  maxVehicles = 100,
): PrioritizedTrafficCandidate[] {
  return candidates
    .map((candidate) => {
      const distance = haversineDistanceMeters(context.userLocation, candidate.location);
      const bearing = bearingDegrees(context.userLocation, candidate.location);
      const heading = context.userHeadingDegrees ?? null;
      const forwardScore = heading == null ? 0.5 : Math.max(0, 1 - angleDelta(heading, bearing) / 180);
      const distanceScore = Math.max(0, 1 - distance / 350);
      const laneScore = context.currentLaneIndex != null && candidate.laneIndex === context.currentLaneIndex ? 1 : 0;
      const maneuverDistance = context.maneuverLocation ? haversineDistanceMeters(candidate.location, context.maneuverLocation) : Infinity;
      const maneuverScore = maneuverDistance <= 100 ? Math.max(0, 1 - maneuverDistance / 100) : 0;
      const priority = distanceScore * 0.35 + forwardScore * 0.25 + laneScore * 0.2 + maneuverScore * 0.1 + candidate.confidence * 0.1;
      return { ...candidate, priority };
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, maxVehicles));
}
