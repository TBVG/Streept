import { Maneuver, SceneRoad } from '../types';
import { destinationMatchesLane, parseOsmLaneSemantics } from './osmLaneSemantics';

export interface DestinationLaneCandidate {
  laneIndex: number;
  destination: string;
  score: number;
  matchesDestination: boolean;
}

export interface DestinationLaneTiming {
  targetLaneIndex: number | null;
  currentLaneIndex: number | null;
  laneDelta: number;
  direction: 'stay' | 'left' | 'right';
  laneChanges: number;
  earliestChangeMeters: number;
  latestChangeMeters: number;
  urgency: 'none' | 'prepare' | 'change-now' | 'too-late';
  confidence: number;
}

export function rankDestinationLanes(road: SceneRoad, maneuver: Maneuver, destinationText: string | null): DestinationLaneCandidate[] {
  const count = Math.max(1, Math.min(8, road.lanes ?? maneuver.lanes?.length ?? 1));
  const semantics = parseOsmLaneSemantics(road, maneuver, count);
  return semantics
    .filter((lane) => Boolean(lane.destination))
    .map((lane) => {
      const matches = destinationMatchesLane(destinationText, lane.destination);
      const turnBonus = lane.routeScore * 0.35;
      return { laneIndex: lane.index, destination: lane.destination!, score: (matches ? 0.65 : 0) + turnBonus, matchesDestination: matches };
    })
    .sort((a, b) => b.score - a.score);
}

export function chooseDestinationLane(road: SceneRoad, maneuver: Maneuver, destinationText: string | null): number | null {
  const ranked = rankDestinationLanes(road, maneuver, destinationText);
  const match = ranked.find((candidate) => candidate.matchesDestination);
  return match?.laneIndex ?? null;
}

export function buildDestinationLaneTiming(
  currentLaneIndex: number | null,
  targetLaneIndex: number | null,
  distanceToManeuverMeters: number,
  minRunwayMeters = 42,
): DestinationLaneTiming {
  if (targetLaneIndex == null || currentLaneIndex == null) {
    return { targetLaneIndex, currentLaneIndex, laneDelta: 0, direction: 'stay', laneChanges: 0, earliestChangeMeters: 0, latestChangeMeters: Math.max(0, distanceToManeuverMeters - 15), urgency: 'none', confidence: 0.5 };
  }
  const delta = targetLaneIndex - currentLaneIndex;
  const laneChanges = Math.abs(delta);
  if (!laneChanges) return { targetLaneIndex, currentLaneIndex, laneDelta: 0, direction: 'stay', laneChanges: 0, earliestChangeMeters: 0, latestChangeMeters: Math.max(0, distanceToManeuverMeters - 10), urgency: 'none', confidence: 1 };
  const latest = Math.max(0, distanceToManeuverMeters - 15);
  const earliest = Math.max(0, latest - Math.max(minRunwayMeters, laneChanges * 32));
  const urgency = distanceToManeuverMeters < 20 ? 'too-late' : distanceToManeuverMeters <= 85 ? 'change-now' : distanceToManeuverMeters <= 150 ? 'prepare' : 'none';
  return { targetLaneIndex, currentLaneIndex, laneDelta: delta, direction: delta < 0 ? 'left' : 'right', laneChanges, earliestChangeMeters: earliest, latestChangeMeters: latest, urgency, confidence: Math.max(0.45, 1 - Math.max(0, laneChanges - 1) * 0.12) };
}
