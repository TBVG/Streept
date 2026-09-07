export type GuidanceAuthorityLevel = 'lane' | 'junction' | 'route' | 'maneuver';

export interface GuidanceAuthoritySnapshot {
  level: GuidanceAuthorityLevel;
  lane: number;
  branch: number;
  continuity: number;
}

export interface SmoothedGuidanceAuthority extends GuidanceAuthoritySnapshot {
  transition: number;
  previousLevel: GuidanceAuthorityLevel | null;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const ease = (value: number) => value * value * (3 - 2 * value);

/**
 * Keeps renderer authority continuous when navigation confidence/fallback
 * changes between GPS updates. It never changes the selected route or lane;
 * it only cross-fades visual ownership between guidance layers.
 */
export class GuidanceTransitionSmoother {
  private key = '';
  private current: GuidanceAuthoritySnapshot | null = null;
  private previousLevel: GuidanceAuthorityLevel | null = null;
  private startedAt = 0;
  private durationMs: number;

  constructor(durationMs = 650) {
    this.durationMs = Math.max(100, durationMs);
  }

  reset() {
    this.key = '';
    this.current = null;
    this.previousLevel = null;
    this.startedAt = 0;
  }

  update(key: string, target: GuidanceAuthoritySnapshot, nowMs = Date.now()): SmoothedGuidanceAuthority {
    if (!this.current || key !== this.key) {
      this.key = key;
      this.current = { ...target };
      this.previousLevel = null;
      this.startedAt = nowMs;
      return { ...target, transition: 1, previousLevel: null };
    }

    const levelChanged = this.current.level !== target.level;
    if (levelChanged) {
      this.previousLevel = this.current.level;
    }

    const elapsed = Math.max(0, nowMs - this.startedAt);
    const t = ease(clamp(elapsed / this.durationMs));
    this.current = {
      level: target.level,
      lane: this.current.lane + (target.lane - this.current.lane) * t,
      branch: this.current.branch + (target.branch - this.current.branch) * t,
      continuity: this.current.continuity + (target.continuity - this.current.continuity) * t,
    };

    if (t >= 1) this.previousLevel = null;
    return { ...this.current, transition: t, previousLevel: this.previousLevel };
  }
}
