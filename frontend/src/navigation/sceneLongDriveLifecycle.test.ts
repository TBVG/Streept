import { describe, expect, it, vi } from 'vitest';
import { SceneLongDriveLifecycle } from './sceneLongDriveLifecycle';

describe('scene long-drive lifecycle', () => {
  it('rejects late async generations', () => {
    const lifecycle = new SceneLongDriveLifecycle<object>();
    const first = lifecycle.beginTransition();
    const second = lifecycle.beginTransition();
    expect(lifecycle.isCurrentGeneration(first)).toBe(false);
    expect(lifecycle.upsert({ key: 'late', value: {}, residency: 'warm', bytesEstimate: 1, generation: first })).toBe(false);
    expect(lifecycle.upsert({ key: 'current', value: {}, residency: 'current', bytesEstimate: 1, generation: second })).toBe(true);
  });

  it('protects current and forward scenes while evicting old warm scenes', () => {
    const lifecycle = new SceneLongDriveLifecycle<object>({ maxActive: 3, maxBytes: 300 });
    lifecycle.beginTransition();
    lifecycle.upsert({ key: 'current', value: {}, residency: 'current', bytesEstimate: 100, nowMs: 10 });
    lifecycle.upsert({ key: 'forward', value: {}, residency: 'forward', bytesEstimate: 100, nowMs: 20 });
    lifecycle.upsert({ key: 'warm-old', value: {}, residency: 'warm', bytesEstimate: 100, nowMs: 1 });
    lifecycle.upsert({ key: 'warm-new', value: {}, residency: 'warm', bytesEstimate: 100, nowMs: 30 });
    const released: object[] = [];
    const evicted = lifecycle.enforceBudgets(40, (value) => released.push(value));
    expect(evicted).toEqual(['warm-old']);
    expect(lifecycle.snapshot().active).toBe(3);
    expect(released).toHaveLength(1);
  });

  it('expires retiring scenes after the grace window', () => {
    const lifecycle = new SceneLongDriveLifecycle<object>();
    lifecycle.beginTransition();
    const value = {};
    lifecycle.upsert({ key: 'old', value, residency: 'warm', bytesEstimate: 10, nowMs: 100 });
    lifecycle.retire('old', 200);
    const release = vi.fn();
    lifecycle.enforceBudgets(5201, release);
    expect(lifecycle.get('old')).toBeUndefined();
    expect(release).toHaveBeenCalledWith(value);
  });
});
