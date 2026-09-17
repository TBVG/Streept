import { DestinationLaneTiming } from './destinationLaneIntelligence';

export type LaneChangeExecutionPhase = 'idle' | 'prepare' | 'changing' | 'completed' | 'missed' | 'uncertain';

export interface LaneChangeExecutionState {
  phase: LaneChangeExecutionPhase;
  sourceLane: number | null;
  targetLane: number | null;
  direction: 'stay' | 'left' | 'right';
  stableLane: number | null;
  stableSamples: number;
  startedAtMeters: number | null;
  distanceToManeuverMeters: number | null;
  deadlineMeters: number | null;
  confidence: number;
  missedReason: 'too-late' | 'unreachable' | 'lane-not-confirmed' | null;
  reachabilityConfidence: number;
  dynamicsConfidence: number;
  recommendedSpeedMps: number | null;
  safetyReason: string | null;
  progressValidated: boolean;
}

export interface LaneChangeExecutionInput {
  currentLaneIndex: number | null;
  currentLaneConfidence: number;
  timing: DestinationLaneTiming | null;
  reachable?: boolean;
  reachabilityConfidence?: number;
  dynamicsConfidence?: number;
  recommendedSpeedMps?: number | null;
  safetyReason?: string | null;
  distanceToManeuverMeters?: number;
  nowMs?: number;
}

const EMPTY: LaneChangeExecutionState = {
  phase: 'idle', sourceLane: null, targetLane: null, direction: 'stay', stableLane: null,
  stableSamples: 0, startedAtMeters: null, distanceToManeuverMeters: null, deadlineMeters: null,
  confidence: 0, missedReason: null, reachabilityConfidence: 0, dynamicsConfidence: 0, recommendedSpeedMps: null, safetyReason: null, progressValidated: true,
};

export class LaneChangeExecutionTracker {
  private state: LaneChangeExecutionState = { ...EMPTY };
  private lastTarget: number | null = null;

  reset(): void {
    this.state = { ...EMPTY };
    this.lastTarget = null;
  }

  update(input: LaneChangeExecutionInput): LaneChangeExecutionState {
    const timing = input.timing;
    if (!timing || timing.targetLaneIndex == null || timing.currentLaneIndex == null) {
      this.state = { ...EMPTY, stableLane: input.currentLaneIndex, stableSamples: input.currentLaneIndex == null ? 0 : 1, confidence: input.currentLaneConfidence };
      this.lastTarget = null;
      return { ...this.state };
    }

    // A maneuver can legitimately require staying in the current lane (for
    // example a through movement across a junction). Treat that as a terminal
    // maneuver once the lane is confidently confirmed instead of leaving the
    // navigation state in `idle` forever.
    if (timing.laneChanges === 0) {
      const stableSamples = input.currentLaneIndex === this.state.stableLane
        ? this.state.stableSamples + 1
        : 1;
      this.state = {
        ...EMPTY,
        phase: input.currentLaneIndex === timing.targetLaneIndex && input.currentLaneConfidence >= 0.62 && stableSamples >= 2 ? 'completed' : 'prepare',
        sourceLane: timing.currentLaneIndex,
        targetLane: timing.targetLaneIndex,
        direction: 'stay',
        stableLane: input.currentLaneIndex,
        stableSamples: Math.min(6, stableSamples),
        distanceToManeuverMeters: input.distanceToManeuverMeters ?? null,
        deadlineMeters: timing.latestChangeMeters,
        confidence: input.currentLaneConfidence,
        reachabilityConfidence: input.reachabilityConfidence ?? 1,
        dynamicsConfidence: input.dynamicsConfidence ?? 1,
        recommendedSpeedMps: input.recommendedSpeedMps ?? null,
        safetyReason: input.safetyReason ?? null,
      };
      this.lastTarget = timing.targetLaneIndex;
      return { ...this.state };
    }

    const target = timing.targetLaneIndex;
    if (this.lastTarget !== target || this.state.sourceLane === target) {
      this.state = {
        ...EMPTY,
        phase: 'prepare', sourceLane: input.currentLaneIndex, targetLane: target,
        direction: timing.direction, stableLane: input.currentLaneIndex,
        stableSamples: 1, distanceToManeuverMeters: input.distanceToManeuverMeters ?? (timing.latestChangeMeters + 15),
        deadlineMeters: timing.latestChangeMeters, confidence: input.currentLaneConfidence, reachabilityConfidence: input.reachabilityConfidence ?? 0, dynamicsConfidence: input.dynamicsConfidence ?? 0, recommendedSpeedMps: input.recommendedSpeedMps ?? null, safetyReason: input.safetyReason ?? null,
      };
      this.lastTarget = target;
    }

    const previousStableLane = this.state.stableLane;
    const observedStep = input.currentLaneIndex != null && previousStableLane != null
      ? Math.abs(input.currentLaneIndex - previousStableLane)
      : 0;
    // GPS/lane matching can occasionally jump across multiple lanes in one
    // fix. Never treat that as a physically executed multi-lane transition.
    // The vehicle must be observed progressing through adjacent lanes first.
    const progressValidated = observedStep <= 1;
    if (!progressValidated) {
      this.state.progressValidated = false;
      this.state.phase = 'uncertain';
      this.state.missedReason = 'lane-not-confirmed';
      this.state.confidence = Math.min(this.state.confidence, input.currentLaneConfidence * 0.6);
      return { ...this.state };
    }
    const sameAsStable = input.currentLaneIndex != null && input.currentLaneIndex === this.state.stableLane;
    const stableSamples = sameAsStable ? this.state.stableSamples + 1 : input.currentLaneIndex == null ? this.state.stableSamples : 1;
    this.state.stableLane = input.currentLaneIndex ?? this.state.stableLane;
    this.state.progressValidated = progressValidated;
    this.state.stableSamples = Math.min(6, stableSamples);
    this.state.confidence = input.currentLaneConfidence;
    this.state.reachabilityConfidence = input.reachabilityConfidence ?? this.state.reachabilityConfidence;
    this.state.dynamicsConfidence = input.dynamicsConfidence ?? this.state.dynamicsConfidence;
    this.state.recommendedSpeedMps = input.recommendedSpeedMps ?? this.state.recommendedSpeedMps;
    this.state.safetyReason = input.safetyReason ?? this.state.safetyReason;
    this.state.distanceToManeuverMeters = input.distanceToManeuverMeters ?? (timing.latestChangeMeters + 15);
    this.state.deadlineMeters = timing.latestChangeMeters;

    if (input.currentLaneIndex === target && input.currentLaneConfidence >= 0.62 && this.state.stableSamples >= 2) {
      this.state.phase = 'completed';
      this.state.startedAtMeters = this.state.startedAtMeters ?? input.distanceToManeuverMeters ?? null;
      this.state.missedReason = null;
      return { ...this.state };
    }

    if (input.reachable === false) {
      const waitingForGap = input.safetyReason === 'waiting-for-gap';
      if (waitingForGap && timing.urgency !== 'too-late' && (input.distanceToManeuverMeters ?? 0) > 20) {
        this.state.phase = 'prepare';
        this.state.missedReason = null;
        return { ...this.state };
      }
      const dynamicUnsafe = waitingForGap || input.safetyReason === 'insufficient-reaction-distance' || input.safetyReason === 'lateral-load-too-high' || input.safetyReason === 'speed-too-high' || input.safetyReason === 'unsafe-gap' || input.safetyReason === 'target-lane-blocked' || input.safetyReason === 'traffic-caution' || input.safetyReason === 'low-confidence';
      if (dynamicUnsafe && (timing.urgency !== 'too-late' && (input.distanceToManeuverMeters ?? 0) > 20)) {
        this.state.phase = 'uncertain';
        this.state.missedReason = 'lane-not-confirmed';
        return { ...this.state };
      }
      this.state.phase = 'missed';
      this.state.missedReason = dynamicUnsafe ? 'too-late' : 'unreachable';
      return { ...this.state };
    }

    if (timing.urgency === 'too-late' || timing.latestChangeMeters <= 0) {
      this.state.phase = 'missed';
      this.state.missedReason = 'too-late';
      return { ...this.state };
    }

    const targetIsApproaching = input.currentLaneIndex != null && input.currentLaneIndex !== this.state.sourceLane;
    const shouldChange = targetIsApproaching || timing.urgency === 'change-now';
    if (shouldChange && input.reachabilityConfidence != null && input.reachabilityConfidence < 0.55) {
      this.state.phase = 'uncertain';
      this.state.missedReason = 'lane-not-confirmed';
      return { ...this.state };
    }
    if (shouldChange && this.state.phase !== 'changing') {
      this.state.startedAtMeters = input.distanceToManeuverMeters ?? null;
    }
    this.state.phase = shouldChange ? 'changing' : 'prepare';
    this.state.missedReason = null;
    return { ...this.state };
  }

  snapshot(): LaneChangeExecutionState { return { ...this.state }; }
}

export function laneChangeExecutionPrompt(state: LaneChangeExecutionState): string | null {
  if (state.phase === 'completed') return 'Lane change complete';
  if (state.phase === 'missed') return state.direction === 'left' ? 'Missed left lane change' : 'Missed right lane change';
  if (state.phase === 'changing') return state.direction === 'left' ? 'Change to the left lane now' : 'Change to the right lane now';
  if (state.phase === 'prepare') {
    if (state.safetyReason === 'waiting-for-gap') return 'Waiting for a safe gap before changing lanes';
    return state.direction === 'left' ? 'Prepare to move to the left lane' : 'Prepare to move to the right lane';
  }
  return null;
}
