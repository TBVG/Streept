import { CurrentLaneMatch } from './currentLaneMatcher';

export interface LaneTrackingObservation {
  laneIndex: number;
  confidence: number;
  physicalDistanceMeters: number;
  headingErrorDegrees: number | null;
  wayId: number | null;
  timestampMs: number;
  accuracyMeters: number | null;
  speedMps: number | null;
}

export interface LaneTrackingState {
  stableLaneIndex: number | null;
  stableWayId: number | null;
  stableSamples: number;
  candidateLaneIndex: number | null;
  candidateWayId: number | null;
  candidateSamples: number;
  confidence: number;
  lastAcceptedAtMs: number | null;
  lostSamples: number;
}

export interface LaneTrackingDecision {
  laneIndex: number | null;
  confidence: number;
  stable: boolean;
  heldPrevious: boolean;
  reacquired: boolean;
  reason: 'initial' | 'stable' | 'hysteresis' | 'poor-gps' | 'reacquired' | 'lost';
}

export function createLaneTrackingState(): LaneTrackingState {
  return {
    stableLaneIndex: null,
    stableWayId: null,
    stableSamples: 0,
    candidateLaneIndex: null,
    candidateWayId: null,
    candidateSamples: 0,
    confidence: 0,
    lastAcceptedAtMs: null,
    lostSamples: 0,
  };
}

export function observationFromMatch(
  match: CurrentLaneMatch,
  timestampMs: number,
  accuracyMeters: number | null,
  speedMps: number | null,
): LaneTrackingObservation {
  const accuracyPenalty = accuracyMeters == null ? 1 : Math.max(0.35, Math.min(1, 1 - Math.max(0, accuracyMeters - 6) / 34));
  const headingPenalty = match.headingErrorDegrees == null ? 1 : Math.max(0.45, 1 - Math.min(1, match.headingErrorDegrees / 100) * 0.45);
  const motionPenalty = speedMps != null && speedMps < 1 ? 0.8 : 1;
  return {
    laneIndex: match.laneIndex ?? -1,
    confidence: Math.max(0, Math.min(1, match.confidence * accuracyPenalty * headingPenalty * motionPenalty)),
    physicalDistanceMeters: match.physicalDistanceMeters,
    headingErrorDegrees: match.headingErrorDegrees,
    wayId: match.wayId,
    timestampMs,
    accuracyMeters,
    speedMps,
  };
}

export class LaneTrackingStability {
  private state = createLaneTrackingState();

  reset(): void {
    this.state = createLaneTrackingState();
  }

  snapshot(): LaneTrackingState {
    return { ...this.state };
  }

  update(observation: LaneTrackingObservation | null): LaneTrackingDecision {
    if (!observation || observation.laneIndex < 0) {
      this.state.lostSamples += 1;
      this.state.confidence *= 0.82;
      return this.state.stableLaneIndex == null
        ? { laneIndex: null, confidence: this.state.confidence, stable: false, heldPrevious: false, reacquired: false, reason: 'lost' }
        : { laneIndex: this.state.stableLaneIndex, confidence: this.state.confidence, stable: true, heldPrevious: true, reacquired: false, reason: 'lost' };
    }

    const poorGps = (observation.accuracyMeters != null && observation.accuracyMeters >= 18)
      || observation.physicalDistanceMeters >= 22
      || (observation.headingErrorDegrees != null && observation.headingErrorDegrees >= 55 && (observation.speedMps ?? 0) >= 2);
    const strong = observation.confidence >= 0.78 && !poorGps;
    const sameStable = this.state.stableLaneIndex === observation.laneIndex && this.state.stableWayId === observation.wayId;

    this.state.lostSamples = 0;
    if (sameStable) {
      this.state.stableSamples += 1;
      this.state.candidateLaneIndex = null;
      this.state.candidateWayId = null;
      this.state.candidateSamples = 0;
      this.state.confidence = Math.min(0.99, Math.max(observation.confidence, this.state.confidence * 0.8 + observation.confidence * 0.2));
      return { laneIndex: observation.laneIndex, confidence: this.state.confidence, stable: true, heldPrevious: false, reacquired: false, reason: 'stable' };
    }

    if (this.state.stableLaneIndex == null) {
      if (!strong && poorGps) {
        this.state.confidence = Math.min(this.state.confidence, observation.confidence);
        return { laneIndex: null, confidence: this.state.confidence, stable: false, heldPrevious: false, reacquired: false, reason: 'poor-gps' };
      }
      this.state.stableLaneIndex = observation.laneIndex;
      this.state.stableWayId = observation.wayId;
      this.state.stableSamples = 1;
      this.state.confidence = observation.confidence;
      this.state.lastAcceptedAtMs = observation.timestampMs;
      return { laneIndex: observation.laneIndex, confidence: observation.confidence, stable: true, heldPrevious: false, reacquired: false, reason: 'initial' };
    }

    if (this.state.candidateLaneIndex === observation.laneIndex && this.state.candidateWayId === observation.wayId) {
      this.state.candidateSamples += 1;
    } else {
      this.state.candidateLaneIndex = observation.laneIndex;
      this.state.candidateWayId = observation.wayId;
      this.state.candidateSamples = 1;
    }

    const sameWay = this.state.stableWayId === observation.wayId;
    const requiredSamples = 2;
    const canAccept = strong && this.state.candidateSamples >= requiredSamples;
    if (canAccept) {
      const previousLane = this.state.stableLaneIndex;
      this.state.stableLaneIndex = observation.laneIndex;
      this.state.stableWayId = observation.wayId;
      this.state.stableSamples = this.state.candidateSamples;
      this.state.candidateLaneIndex = null;
      this.state.candidateWayId = null;
      this.state.candidateSamples = 0;
      this.state.confidence = observation.confidence;
      this.state.lastAcceptedAtMs = observation.timestampMs;
      return { laneIndex: observation.laneIndex, confidence: observation.confidence, stable: true, heldPrevious: false, reacquired: previousLane !== observation.laneIndex, reason: sameWay ? 'reacquired' : 'reacquired' };
    }

    const heldConfidence = Math.max(0.2, Math.min(this.state.confidence * 0.96, observation.confidence * (poorGps ? 0.65 : 0.82)));
    this.state.confidence = heldConfidence;
    return {
      laneIndex: this.state.stableLaneIndex,
      confidence: heldConfidence,
      stable: true,
      heldPrevious: true,
      reacquired: false,
      reason: poorGps ? 'poor-gps' : 'hysteresis',
    };
  }
}
