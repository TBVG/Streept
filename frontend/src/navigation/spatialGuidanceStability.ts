import { SpatialGuidanceDecision } from './spatialGuidanceDecision';

/**
 * Prevents one noisy GPS/scene sample from making the driver-facing guidance
 * jump between states. Escalations happen immediately; de-escalations are
 * held briefly so a maneuver cue does not flicker as the GPS position moves
 * across a threshold.
 */
export class SpatialGuidanceStabilizer {
  private current: SpatialGuidanceDecision | null = null;
  private changedAt = 0;

  constructor(private readonly downgradeHoldMs = 900) {}

  reset(): void {
    this.current = null;
    this.changedAt = 0;
  }

  update(next: SpatialGuidanceDecision, nowMs = Date.now()): SpatialGuidanceDecision {
    if (!this.current) {
      this.current = next;
      this.changedAt = nowMs;
      return next;
    }

    const currentRank = this.rank(this.current.action);
    const nextRank = this.rank(next.action);
    const safetyEscalation = next.action === 'uncertain' && this.current.action !== 'uncertain';
    const escalation = safetyEscalation || nextRank > currentRank;
    const same = next.action === this.current.action && next.reason === this.current.reason;

    if (same) {
      this.current = next;
      return next;
    }

    if (escalation || nowMs - this.changedAt >= this.downgradeHoldMs) {
      this.current = next;
      this.changedAt = nowMs;
    }

    return this.current;
  }

  private rank(action: SpatialGuidanceDecision['action']): number {
    switch (action) {
      case 'uncertain': return 0;
      case 'high-alert': return 4;
      case 'slow': return 2;
      case 'prepare': return 1;
      case 'continue': return 0;
    }
  }
}
