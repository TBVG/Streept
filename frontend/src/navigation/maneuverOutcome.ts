import { Maneuver } from '../types';
import { SpatialIntelligenceSnapshot } from './spatialIntelligence';

export type ManeuverOutcomeStatus = 'tracking' | 'completed' | 'missed' | 'unknown';

export interface ManeuverOutcome {
  status: ManeuverOutcomeStatus;
  maneuverKey: string | null;
  instruction: string | null;
  laneCompliant: boolean | null;
  distanceAtEvaluationMeters: number | null;
  completedCount: number;
  missedCount: number;
}

export interface ManeuverOutcomeInput {
  spatial: SpatialIntelligenceSnapshot;
  routeGeneration: number;
}

const APPROACH_METERS = 25;
const PASSED_METERS = 35;

function keyForManeuver(maneuver: Maneuver | null): string | null {
  if (!maneuver) return null;
  const lat = Number(maneuver.location?.lat ?? 0).toFixed(5);
  const lng = Number(maneuver.location?.lng ?? 0).toFixed(5);
  return `${maneuver.type}|${maneuver.modifier ?? ''}|${lat}|${lng}`;
}

function emptyOutcome(): ManeuverOutcome {
  return {
    status: 'unknown', maneuverKey: null, instruction: null, laneCompliant: null,
    distanceAtEvaluationMeters: null, completedCount: 0, missedCount: 0,
  };
}

/**
 * Converts continuous route/maneuver observations into coarse execution
 * outcomes. It deliberately avoids claiming success from a single noisy GPS
 * sample: a maneuver must first enter an approach window and then leave it.
 */
export class ManeuverOutcomeTracker {
  private routeGeneration: number | null = null;
  private activeKey: string | null = null;
  private activeInstruction: string | null = null;
  private approached = false;
  private completedCount = 0;
  private missedCount = 0;
  private lastOutcome: ManeuverOutcome = emptyOutcome();

  reset(routeGeneration: number | null = null): void {
    this.routeGeneration = routeGeneration;
    this.activeKey = null;
    this.activeInstruction = null;
    this.approached = false;
    this.completedCount = 0;
    this.missedCount = 0;
    this.lastOutcome = emptyOutcome();
  }

  update(input: ManeuverOutcomeInput): ManeuverOutcome {
    if (this.routeGeneration !== input.routeGeneration) this.reset(input.routeGeneration);

    const maneuver = input.spatial.nextManeuver;
    const key = keyForManeuver(maneuver);
    const distance = input.spatial.maneuverDistanceMeters;
    const laneAlignment = input.spatial.laneIntelligence.laneAlignment;

    if (!maneuver || key == null || distance == null || !Number.isFinite(distance)) {
      if (this.approached && this.activeKey) {
        this.completedCount += 1;
        this.lastOutcome = {
          status: 'completed', maneuverKey: this.activeKey, instruction: this.activeInstruction,
          laneCompliant: laneAlignment === 'aligned' ? true : laneAlignment === 'misaligned' ? false : null,
          distanceAtEvaluationMeters: distance, completedCount: this.completedCount, missedCount: this.missedCount,
        };
      }
      this.activeKey = null;
      this.activeInstruction = null;
      this.approached = false;
      return this.lastOutcome;
    }

    if (this.activeKey && key !== this.activeKey) {
      const completed = this.approached;
      if (completed) this.completedCount += 1;
      else this.missedCount += 1;
      const transitionOutcome: ManeuverOutcome = {
        status: completed ? 'completed' : 'missed',
        maneuverKey: this.activeKey,
        instruction: this.activeInstruction,
        laneCompliant: laneAlignment === 'aligned' ? true : laneAlignment === 'misaligned' ? false : null,
        distanceAtEvaluationMeters: distance,
        completedCount: this.completedCount,
        missedCount: this.missedCount,
      };
      this.activeKey = key;
      this.activeInstruction = maneuver.instruction ?? null;
      this.approached = distance <= APPROACH_METERS;
      this.lastOutcome = transitionOutcome;
      return transitionOutcome;
    }

    this.activeKey = key;
    this.activeInstruction = maneuver.instruction ?? null;
    if (distance <= APPROACH_METERS) this.approached = true;

    if (this.approached && distance >= PASSED_METERS) {
      this.completedCount += 1;
      this.lastOutcome = {
        status: 'completed', maneuverKey: key, instruction: this.activeInstruction,
        laneCompliant: laneAlignment === 'aligned' ? true : laneAlignment === 'misaligned' ? false : null,
        distanceAtEvaluationMeters: distance, completedCount: this.completedCount, missedCount: this.missedCount,
      };
      this.approached = false;
    } else {
      this.lastOutcome = {
        status: 'tracking', maneuverKey: key, instruction: this.activeInstruction,
        laneCompliant: laneAlignment === 'aligned' ? true : laneAlignment === 'misaligned' ? false : null,
        distanceAtEvaluationMeters: distance, completedCount: this.completedCount, missedCount: this.missedCount,
      };
    }

    return this.lastOutcome;
  }

  snapshot(): ManeuverOutcome { return { ...this.lastOutcome }; }
}
