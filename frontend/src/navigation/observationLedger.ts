import { ManeuverOutcome } from './maneuverOutcome';
import { SpatialIntelligenceSnapshot } from './spatialIntelligence';

export type SpatialObservationType = 'maneuver_completed' | 'maneuver_missed' | 'hazard_observed' | 'lane_misalignment';

export interface SpatialObservation {
  id: string;
  at: number;
  type: SpatialObservationType;
  routeGeneration: number;
  maneuverKey: string | null;
  wayId: number | null;
  maneuver: string;
  laneAlignment: 'aligned' | 'misaligned' | 'unknown';
  confidence: number;
  syncedAt?: number;
}

const STORAGE_KEY = 'streept_spatial_observations_v1';
const MAX_OBSERVATIONS = 300;

function id(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `obs-${crypto.randomUUID()}`;
  return `obs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Local-first learning ledger. It stores coarse navigation outcomes only;
 * raw GPS traces, account identifiers and photos are deliberately excluded. */
export class SpatialObservationLedger {
  private readonly now: () => number;
  private observations: SpatialObservation[];

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.observations = this.load();
  }

  recordManeuverOutcome(outcome: ManeuverOutcome, spatial: SpatialIntelligenceSnapshot, routeGeneration: number): void {
    if (outcome.status !== 'completed' && outcome.status !== 'missed') return;
    this.append({
      type: outcome.status === 'completed' ? 'maneuver_completed' : 'maneuver_missed',
      routeGeneration,
      maneuverKey: outcome.maneuverKey,
      wayId: spatial.wayId,
      maneuver: spatial.maneuver,
      laneAlignment: outcome.laneCompliant === true ? 'aligned' : outcome.laneCompliant === false ? 'misaligned' : spatial.laneIntelligence.laneAlignment,
      confidence: Math.max(0, Math.min(1, spatial.confidence)),
    });
  }

  recordHazard(spatial: SpatialIntelligenceSnapshot, routeGeneration: number): void {
    if (spatial.hazardIntelligence.level === 'none') return;
    this.append({
      type: 'hazard_observed', routeGeneration, maneuverKey: null, wayId: spatial.wayId,
      maneuver: spatial.maneuver, laneAlignment: spatial.laneIntelligence.laneAlignment,
      confidence: Math.max(0, Math.min(1, spatial.hazardIntelligence.confidence)),
    });
  }

  recordLaneMisalignment(spatial: SpatialIntelligenceSnapshot, routeGeneration: number): void {
    const lane = spatial.laneIntelligence;
    if (lane.laneAlignment !== 'misaligned' || lane.requiredLaneChanges <= 0) return;
    this.append({
      type: 'lane_misalignment', routeGeneration, maneuverKey: null, wayId: spatial.wayId,
      maneuver: spatial.maneuver, laneAlignment: lane.laneAlignment,
      confidence: Math.max(0, Math.min(1, lane.confidence)),
    });
  }

  snapshot(): SpatialObservation[] { return this.observations.map((item) => ({ ...item })); }

  pending(limit = 50): SpatialObservation[] {
    return this.observations.filter((item) => !item.syncedAt).slice(0, Math.max(1, Math.min(50, limit))).map((item) => ({ ...item }));
  }

  markSynced(ids: string[], at: number = this.now()): void {
    if (!ids.length) return;
    const wanted = new Set(ids);
    this.observations = this.observations.map((item) => wanted.has(item.id) ? { ...item, syncedAt: at } : item);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.observations)); } catch { /* best effort */ }
  }

  async flushToCloud(send: (observations: SpatialObservation[]) => Promise<unknown>, limit = 50): Promise<number> {
    const batch = this.pending(limit);
    if (!batch.length) return 0;
    try {
      await send(batch);
      this.markSynced(batch.map((item) => item.id));
      return batch.length;
    } catch {
      return 0;
    }
  }

  clear(): void {
    this.observations = [];
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }

  private append(input: Omit<SpatialObservation, 'id' | 'at'>): void {
    const observation = { ...input, id: id(), at: this.now() };
    this.observations = [...this.observations, observation].slice(-MAX_OBSERVATIONS);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.observations)); } catch { /* best effort */ }
  }

  private load(): SpatialObservation[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(-MAX_OBSERVATIONS) : [];
    } catch { return []; }
  }
}
