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

  const steps: RouteLaneStrategyStep[] = [];
  let totalLaneChanges = 0;
  let confidence = Math.max(0, Math.min(1, currentLaneConfidence));

  // Solve each contiguous metadata segment as a small dynamic-programming
  // problem. This is the important distinction from a greedy lane choice:
  // the best lane for maneuver N may be the lane that avoids two unnecessary
  // changes at maneuvers N+1 and N+2. We only optimize lanes actually present
  // in the route metadata.
  let segmentStart = 0;
  while (segmentStart < maneuvers.length) {
    while (segmentStart < maneuvers.length && candidateLanes(buildLaneTopology(maneuvers[segmentStart])).length === 0) {
      steps.push({
        maneuverIndex: segmentStart, plannedLaneIndex: null, nextLaneIndex: null,
        laneChangesFromPrevious: 0, lookaheadLaneChanges: 0,
        stabilityScore: 0, confidence: confidence * 0.8,
      });
      confidence *= 0.8;
      segmentStart += 1;
    }
    if (segmentStart >= maneuvers.length) break;

    let segmentEnd = segmentStart;
    while (segmentEnd + 1 < maneuvers.length && candidateLanes(buildLaneTopology(maneuvers[segmentEnd + 1])).length > 0) segmentEnd += 1;

    const candidates = maneuvers.slice(segmentStart, segmentEnd + 1).map((maneuver) => candidateLanes(buildLaneTopology(maneuver)));
    type State = { cost: number; lane: number; previousLane: number | null; direction: number; path: number[] };
    let states: State[] = candidates[0].map((lane) => {
      const initialDelta = currentLaneIndex == null ? 0 : Math.abs(lane.laneIndex - currentLaneIndex);
      const initialJumpPenalty = currentLaneIndex != null && initialDelta > 1 ? 1.5 * (initialDelta - 1) : 0;
      const preferredBonus = lane.recommended ? -1.5 : 0;
      const destinationBonus = lane.destination != null ? -0.15 : 0;
      return {
        cost: initialDelta * 3 + initialJumpPenalty + preferredBonus + destinationBonus,
        lane: lane.laneIndex,
        previousLane: currentLaneIndex,
        direction: currentLaneIndex == null ? 0 : Math.sign(lane.laneIndex - currentLaneIndex),
        path: [lane.laneIndex],
      };
    });

    for (let i = 1; i < candidates.length; i += 1) {
      const nextStates: State[] = [];
      for (const lane of candidates[i]) {
        let best: State | null = null;
        for (const previous of states) {
          const delta = Math.abs(lane.laneIndex - previous.lane);
          const direction = Math.sign(lane.laneIndex - previous.lane);
          const reverses = direction !== 0 && previous.direction !== 0 && direction !== previous.direction;
          const preferredBonus = lane.recommended ? -1.5 : 0;
          const destinationBonus = lane.destination != null ? -0.15 : 0;
          const stabilityPenalty = reverses ? 4 : 0;
          const largeJumpPenalty = delta > 1 ? 1.5 * (delta - 1) : 0;
          const cost = previous.cost + delta * 3 + largeJumpPenalty + stabilityPenalty + preferredBonus + destinationBonus;
          const state: State = {
            cost, lane: lane.laneIndex, previousLane: previous.lane,
            direction, path: [...previous.path, lane.laneIndex],
          };
          if (!best || state.cost < best.cost || (state.cost === best.cost && state.lane < best.lane)) best = state;
        }
        if (best) nextStates.push(best);
      }
      states = nextStates;
    }

    const bestFinal = [...states].sort((a, b) => a.cost - b.cost || a.lane - b.lane)[0];
    if (!bestFinal) {
      segmentStart = segmentEnd + 1;
      continue;
    }

    const path = bestFinal.path;
    for (let localIndex = 0; localIndex < path.length; localIndex += 1) {
      const maneuverIndex = segmentStart + localIndex;
      const plannedLaneIndex = path[localIndex];
      const fromLane = localIndex === 0 ? currentLaneIndex : path[localIndex - 1];
      const laneChanges = fromLane == null ? 0 : Math.abs(plannedLaneIndex - fromLane);
      totalLaneChanges += laneChanges;
      const future = path.slice(localIndex + 1, localIndex + 1 + Math.max(1, lookahead));
      const lookaheadLaneChanges = future.reduce((sum, lane, offset) => {
        const from = offset === 0 ? plannedLaneIndex : future[offset - 1];
        return sum + Math.abs(lane - from);
      }, 0);
      const reversals = future.reduce((count, lane, offset) => {
        const from = offset === 0 ? plannedLaneIndex : future[offset - 1];
        const prior = offset === 0 ? fromLane : future[offset - 1];
        if (prior == null) return count;
        return count + (Math.sign(lane - from) !== 0 && Math.sign(from - prior) !== 0 && Math.sign(lane - from) !== Math.sign(from - prior) ? 1 : 0);
      }, 0);
      const stepConfidence = Math.max(0.45, Math.min(1, confidence * (laneChanges > 1 ? 0.86 : 0.98) * (reversals ? 0.92 : 1)));
      steps.push({
        maneuverIndex, plannedLaneIndex,
        nextLaneIndex: path[localIndex + 1] ?? null,
        laneChangesFromPrevious: laneChanges,
        lookaheadLaneChanges,
        stabilityScore: Math.max(0, Math.min(1, 1 - Math.min(1, (laneChanges * 3 + reversals * 4) / 12))),
        confidence: stepConfidence,
      });
      confidence = Math.min(confidence, stepConfidence);
    }

    segmentStart = segmentEnd + 1;
  }

  steps.sort((a, b) => a.maneuverIndex - b.maneuverIndex);
  const metadataCoverage = steps.filter((step) => step.plannedLaneIndex != null).length / Math.max(1, maneuvers.length);
  const finalConfidence = Math.max(0, Math.min(1, confidence * (0.7 + 0.3 * metadataCoverage)));
  return { steps, totalLaneChanges, confidence: finalConfidence };
}

export function routeLaneTargets(maneuvers: Maneuver[], currentLaneIndex: number | null, currentLaneConfidence = 1, lookahead = 3): number[] {
  return buildRouteLaneStrategy(maneuvers, currentLaneIndex, currentLaneConfidence, lookahead).steps.map((step) => step.plannedLaneIndex ?? -1);
}

export function routeHasLaneMetadata(maneuvers: Maneuver[]): boolean {
  return maneuvers.some((maneuver) => targetSet(maneuver).size > 0);
}
