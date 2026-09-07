import { buildDriverGuidanceFallback } from './driverGuidanceFallback';

const c = (o: Partial<any> = {}) => ({ overall: 0.9, lane: 0.9, topology: 0.9, gps: 0.9, scene: 0.9, guidanceAlpha: 0.9, branchAlpha: 0.9, ...o });

describe('buildDriverGuidanceFallback', () => {
  it('prefers lane-level guidance when lane and GPS confidence are strong', () => {
    expect(buildDriverGuidanceFallback(c(), true, true).level).toBe('lane');
  });
  it('falls back to junction topology when lane matching is uncertain', () => {
    expect(buildDriverGuidanceFallback(c({ lane: 0.45 }), true, true).level).toBe('junction');
  });
  it('falls back to route continuity when topology cannot be trusted', () => {
    expect(buildDriverGuidanceFallback(c({ lane: 0.4, topology: 0.4 }), true, false).level).toBe('route');
  });
  it('avoids physical claims during severe uncertainty', () => {
    expect(buildDriverGuidanceFallback(c({ overall: 0.25, gps: 0.2, lane: 0.2, topology: 0.2 }), true, true).level).toBe('maneuver');
  });
});
