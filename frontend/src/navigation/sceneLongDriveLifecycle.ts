import { ScenePrimitivePool } from './scenePrimitivePool';

export type SceneResidency = 'current' | 'forward' | 'warm' | 'retiring';

export interface SceneLease<T> {
  key: string;
  value: T;
  residency: SceneResidency;
  generation: number;
  lastTouchedMs: number;
  bytesEstimate: number;
}

export interface SceneLifecycleSnapshot {
  active: number;
  current: number;
  forward: number;
  warm: number;
  retiring: number;
  estimatedBytes: number;
  generation: number;
}

/**
 * Long-drive lifecycle coordinator. It deliberately knows nothing about Cesium:
 * renderers hand it scene containers and a destroy/release callback. This keeps
 * async bubble churn bounded and makes memory behavior deterministic in tests.
 */
export class SceneLongDriveLifecycle<T> {
  private readonly leases = new Map<string, SceneLease<T>>();
  private readonly maxActive: number;
  private readonly maxBytes: number;
  private generation = 0;

  constructor(options: { maxActive?: number; maxBytes?: number } = {}) {
    this.maxActive = Math.max(2, options.maxActive ?? 12);
    this.maxBytes = Math.max(1, options.maxBytes ?? 64 * 1024 * 1024);
  }

  beginTransition(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrentGeneration(generation: number): boolean {
    return generation === this.generation;
  }

  upsert(input: Omit<SceneLease<T>, 'generation' | 'lastTouchedMs'> & { nowMs?: number; generation?: number }): boolean {
    if (input.generation !== undefined && !this.isCurrentGeneration(input.generation)) return false;
    const nowMs = input.nowMs ?? Date.now();
    const existing = this.leases.get(input.key);
    this.leases.set(input.key, {
      ...input,
      generation: input.generation ?? this.generation,
      lastTouchedMs: nowMs,
    });
    if (existing && existing.value !== input.value && existing.residency !== 'retiring') {
      existing.residency = 'retiring';
      existing.lastTouchedMs = nowMs;
    }
    return true;
  }

  touch(key: string, nowMs = Date.now(), residency?: SceneResidency): boolean {
    const lease = this.leases.get(key);
    if (!lease) return false;
    lease.lastTouchedMs = nowMs;
    if (residency) lease.residency = residency;
    return true;
  }

  retire(key: string, nowMs = Date.now()): boolean {
    return this.touch(key, nowMs, 'retiring');
  }

  /** Evict oldest non-current scenes until both residency budgets are satisfied. */
  enforceBudgets(nowMs = Date.now(), release?: (value: T) => void): string[] {
    const evicted: string[] = [];
    const ordered = [...this.leases.values()].sort((a, b) => a.lastTouchedMs - b.lastTouchedMs);
    const protectedKeys = new Set(
      ordered.filter((lease) => lease.residency === 'current' || lease.residency === 'forward').map((lease) => lease.key),
    );
    const bytes = () => [...this.leases.values()].reduce((sum, lease) => sum + Math.max(0, lease.bytesEstimate), 0);

    for (const lease of ordered) {
      if (this.leases.size <= this.maxActive && bytes() <= this.maxBytes) break;
      if (protectedKeys.has(lease.key) && this.leases.size > this.maxActive) continue;
      this.leases.delete(lease.key);
      try { release?.(lease.value); } catch { /* cleanup must not break navigation */ }
      evicted.push(lease.key);
    }

    // A retiring lease that survived the budget pass is still eligible for a
    // short grace period; after that, remove it even if the budgets are roomy.
    for (const lease of [...this.leases.values()]) {
      if (lease.residency === 'retiring' && nowMs - lease.lastTouchedMs > 5000) {
        this.leases.delete(lease.key);
        try { release?.(lease.value); } catch {}
        evicted.push(lease.key);
      }
    }
    return evicted;
  }

  clear(release?: (value: T) => void): void {
    for (const lease of this.leases.values()) {
      try { release?.(lease.value); } catch {}
    }
    this.leases.clear();
  }

  get(key: string): SceneLease<T> | undefined { return this.leases.get(key); }

  snapshot(): SceneLifecycleSnapshot {
    const values = [...this.leases.values()];
    return {
      active: values.length,
      current: values.filter((x) => x.residency === 'current').length,
      forward: values.filter((x) => x.residency === 'forward').length,
      warm: values.filter((x) => x.residency === 'warm').length,
      retiring: values.filter((x) => x.residency === 'retiring').length,
      estimatedBytes: values.reduce((sum, x) => sum + Math.max(0, x.bytesEstimate), 0),
      generation: this.generation,
    };
  }
}

/** Renderer helper: keep the pool and lifecycle coordinated during handoff. */
export const releaseSceneContainer = <T extends { removeAll?: () => void }>(
  pool: ScenePrimitivePool<T>,
  container: T,
): void => {
  pool.release(container);
};
