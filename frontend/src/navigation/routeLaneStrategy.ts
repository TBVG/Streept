import { Maneuver } from '../types';
import { buildLaneTopology, LaneTopology } from './laneIntelligence';

export interface RouteLaneStrategyStep {
  maneuverIndex: number;
  plannedLaneIndex: number | null;
  nextLaneIndex: number | null;
  laneChangesFromPrevious: number;
  lookaheadLaneChanges: number;
  stabilityScore: number;
  confidence: number;
}

export interface RouteLaneStrategy {
  steps: RouteLaneStrategyStep[];
  totalLaneChanges: number;
  confidence: number;
}



function candidateLanes(topology: LaneTopology[]): LaneTopology[] {
  if (!topology.length) return [];
  const preferred = topology.filter((lane) => lane.recommended);
  return preferred.length ? preferred : topology.filter((lane) => lane.destination != null || lane.indications.length > 0);
}

function targetSet(maneuver: Maneuver): Set<number> {
  const topology = buildLaneTopology(maneuver);
  return new Set(candidateLanes(topology).map((lane) => lane.laneIndex));
}

/**
 * Route-wide lane strategy. It looks several maneuvers ahead and penalizes
 * unnecessary lane changes, repeated lateral oscillation, and late convergence.
 * The strategy is deliberately conservative: it only chooses lanes represented
 * by the route's lane metadata and never creates a lane that OSM/OSRM did not
 * describe.
 */
export function buildRouteLaneStrategy(
  maneuvers: Maneuver[],
  currentLaneIndex: number | null,
  currentLaneConfidence = 1,
  lookahead = 3,
): RouteLaneStrategy {
  if (!maneuvers.length) return { steps: [], totalLaneChanges: 0, confidence: currentLaneConfidence };

  // Keep the strategy explicitly sequential. A maneuver without lane metadata
  // is a genuine information gap, not a request to manufacture lane 0. We
  // therefore emit null for that maneuver while retaining the last known lane
  // as the state used by the next maneuver that has real metadata.
  const steps: RouteLaneStrategyStep[] = [];
  let previousLane = currentLaneIndex;
  let totalLaneChanges = 0;
  let confidence = Math.max(0, Math.min(1, currentLaneConfidence));

  maneuvers.forEach((maneuver, maneuverIndex) => {
    const topology = buildLaneTopology(maneuver);
    const candidates = candidateLanes(topology);
    if (!candidates.length) {
      steps.push({
        maneuverIndex, plannedLaneIndex: null, nextLaneIndex: null,
        laneChangesFromPrevious: 0, lookaheadLaneChanges: 0,
        stabilityScore: 0, confidence: confidence * 0.8,
      });
      confidence *= 0.8;
      return;
    }

    // Prefer the candidate requiring the fewest physical changes. When tied,
    // prefer explicit recommendations and then the lane nearest the prior
    // position. This prevents route-wide oscillation without inventing data.
    const ranked = candidates.map((lane) => {
      const delta = previousLane == null ? 0 : Math.abs(lane.laneIndex - previousLane);
      const recommendedBonus = lane.recommended ? -1.5 : 0;
      const destinationBonus = lane.destination != null ? -0.15 : 0;
      return { lane: lane.laneIndex, score: delta * 3 + recommendedBonus + destinationBonus, delta };
    }).sort((a, b) => a.score - b.score || a.lane - b.lane);
    const chosen = ranked[0];
    const laneChanges = previousLane == null ? 0 : chosen.delta;
    totalLaneChanges += laneChanges;

    const futureCandidates = maneuvers.slice(maneuverIndex + 1, maneuverIndex + 1 + Math.max(1, lookahead))
      .flatMap((future) => candidateLanes(buildLaneTopology(future)))
      .map((lane) => lane.laneIndex);
    const futureChanges = futureCandidates.length && previousLane != null
      ? Math.min(...futureCandidates.map((lane) => Math.abs(lane - chosen.lane)))
      : 0;

    const stepConfidence = Math.max(0.45, Math.min(1, confidence * (laneChanges > 1 ? 0.86 : 0.98)));
    steps.push({
      maneuverIndex, plannedLaneIndex: chosen.lane, nextLaneIndex: null,
      laneChangesFromPrevious: laneChanges,
      lookaheadLaneChanges: futureChanges,
      stabilityScore: Math.max(0, Math.min(1, 1 - Math.min(1, chosen.score / 12))),
      confidence: stepConfidence,
    });
    previousLane = chosen.lane;
    confidence = Math.min(confidence, stepConfidence);
  });

  for (let i = 0; i < steps.length; i += 1) {
    steps[i].nextLaneIndex = steps[i + 1]?.plannedLaneIndex ?? null;
  }

  const metadataCoverage = steps.filter((step) => step.plannedLaneIndex != null).length / Math.max(1, maneuvers.length);
  const finalConfidence = Math.max(0, Math.min(1, confidence * (0.7 + 0.3 * metadataCoverage)));
  return { steps, totalLaneChanges, confidence: finalConfidence, };
}

export function routeLaneTargets(maneuvers: Maneuver[], currentLaneIndex: number | null, currentLaneConfidence = 1, lookahead = 3): number[] {
  return buildRouteLaneStrategy(maneuvers, currentLaneIndex, currentLaneConfidence, lookahead).steps.map((step) => step.plannedLaneIndex ?? -1);
}

export function routeHasLaneMetadata(maneuvers: Maneuver[]): boolean {
  return maneuvers.some((maneuver) => targetSet(maneuver).size > 0);
}
