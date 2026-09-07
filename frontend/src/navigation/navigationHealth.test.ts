import { describe, expect, it } from 'vitest';
import { deriveNavigationHealth } from './navigationCore';

describe('navigation health', () => {
  it('marks a fresh trusted match as healthy', () => {
    const health = deriveNavigationHealth(
      { confidence: 0.92, onRoute: true } as any,
      9_500,
      10_000,
    );
    expect(health.gps).toBe('good');
    expect(health.route).toBe('on-route');
    expect(health.confidence).toBeCloseTo(0.92);
  });

  it('does not encourage reroute decisions during a GPS gap', () => {
    const health = deriveNavigationHealth(
      { confidence: 0.82, onRoute: true } as any,
      0,
      10_000,
    );
    expect(health.gps).toBe('lost');
  });
});
