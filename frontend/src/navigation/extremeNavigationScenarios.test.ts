import { describe, expect, it } from 'vitest';
import { classifyExtremeNavigation } from './extremeNavigationScenarios';

describe('extreme navigation scenarios', () => {
  const base = { previousLocation: { lat: 0, lng: 0 }, currentLocation: { lat: 0, lng: 0.00005 }, previousHeadingDegrees: 90, currentHeadingDegrees: 90, speedMps: 12, accuracyMeters: 8, previousProgressMeters: 100, currentProgressMeters: null, routeBearingDegrees: 90 };
  it('widens matching after a GPS jump', () => expect(classifyExtremeNavigation({ ...base, currentLocation: { lat: 0.01, lng: 0.01 } }).scenario).toBe('gps-jump'));
  it('allows progress reversal for a U-turn', () => expect(classifyExtremeNavigation({ ...base, currentHeadingDegrees: 270, routeBearingDegrees: 90 }).allowReverseProgress).toBe(true));
  it('treats low-speed fixes as stopped', () => expect(classifyExtremeNavigation({ ...base, speedMps: 0.2 }).scenario).toBe('stopped'));
  it('widens the matcher for route reversal', () => expect(classifyExtremeNavigation({ ...base, currentHeadingDegrees: 270, routeBearingDegrees: 90 }).matchingWindowSegments).toBe(48));
});
