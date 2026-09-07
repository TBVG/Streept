import { describe, expect, it, vi } from 'vitest';
import { ScenePrimitivePool } from './scenePrimitivePool';

describe('scene primitive pool', () => {
  it('reuses released collections', () => {
    const pool = new ScenePrimitivePool<any>(2);
    const first = { removeAll: vi.fn() };
    expect(pool.acquire(() => first)).toBe(first);
    pool.release(first);
    expect(first.removeAll).toHaveBeenCalledTimes(1);
    expect(pool.acquire(() => ({ removeAll() {} }))).toBe(first);
  });
  it('bounds retained collections', () => {
    const pool = new ScenePrimitivePool<any>(1);
    const a = { removeAll() {} }, b = { removeAll() {} };
    pool.release(a); pool.release(b);
    expect(pool.size).toBe(1);
  });
  it('clears pooled collections', () => {
    const pool = new ScenePrimitivePool<any>(2);
    const a = { removeAll: vi.fn() };
    pool.release(a); pool.clear();
    expect(a.removeAll).toHaveBeenCalledTimes(2);
    expect(pool.size).toBe(0);
  });
});
