import { Maneuver, SceneRoad } from '../types';
import { parseOsmLaneSemantics } from './osmLaneSemantics';

export type LaneAlignment = 'aligned' | 'misaligned' | 'unknown';
export type LaneChangeDirection = 'left' | 'right' | 'stay' | 'unknown';

export interface SpatialLaneIntelligence {
  currentLaneIndex: number | null;
  recommendedLaneIndices: number[];
  laneAlignment: LaneAlignment;
  laneChangeDirection: LaneChangeDirection;
  requiredLaneChanges: number;
  confidence: number;
}

export function deriveSpatialLaneIntelligence(
  road: SceneRoad | null,
  maneuver: Maneuver | null,
  currentLaneIndex: number | null,
): SpatialLaneIntelligence {
  if (!road || !maneuver || currentLaneIndex == null) {
    return { currentLaneIndex, recommendedLaneIndices: [], laneAlignment: 'unknown', laneChangeDirection: 'unknown', requiredLaneChanges: 0, confidence: 0 };
  }

  const count = Math.max(1, Math.min(8, road.lanes ?? maneuver.lanes?.length ?? 1));
  const semantics = parseOsmLaneSemantics(road, maneuver, count);
  const recommendedLaneIndices = semantics.filter((lane) => lane.routeScore === 1).map((lane) => lane.index);

  if (!recommendedLaneIndices.length) {
    return { currentLaneIndex, recommendedLaneIndices: [], laneAlignment: 'unknown', laneChangeDirection: 'unknown', requiredLaneChanges: 0, confidence: 0.35 };
  }

  const nearest = recommendedLaneIndices.reduce((best, lane) =>
    Math.abs(lane - currentLaneIndex) < Math.abs(best - currentLaneIndex) ? lane : best,
    recommendedLaneIndices[0],
  );
  const requiredLaneChanges = Math.abs(nearest - currentLaneIndex);
  const laneAlignment: LaneAlignment = requiredLaneChanges === 0 ? 'aligned' : 'misaligned';
  const laneChangeDirection: LaneChangeDirection = requiredLaneChanges === 0
    ? 'stay'
    : nearest < currentLaneIndex ? 'left' : 'right';

  return {
    currentLaneIndex,
    recommendedLaneIndices,
    laneAlignment,
    laneChangeDirection,
    requiredLaneChanges,
    confidence: semantics.some((lane) => lane.change != null) ? 0.9 : 0.75,
  };
}
