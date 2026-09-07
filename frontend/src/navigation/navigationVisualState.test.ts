import { describe, expect, it } from 'vitest';
import { deriveNavigationVisualState } from './navigationVisualState';

const base = { sessionActive: true, distanceToManeuverMeters: 300, laneGuidance: 'Stay in this lane', laneConfidence: 1, gpsConfidence: 1, immersiveAvailable: true };

describe('navigation visual regression contract', () => {
  it('covers every lifecycle state with deterministic output', () => {
    const cases = [
      ['idle', false, false, false],
      ['previewing', true, true, false],
      ['navigating', true, true, false],
      ['rerouting', true, true, false],
      ['arrived', false, true, true],
    ] as const;
    expect(cases.map(([phase, active]) => deriveNavigationVisualState({ ...base, phase, sessionActive: active }))).toMatchSnapshot();
  });

  it('raises urgency as a maneuver approaches', () => {
    expect(deriveNavigationVisualState({ ...base, phase: 'navigating', distanceToManeuverMeters: 100 }).guidanceUrgency).toBe('prepare');
    expect(deriveNavigationVisualState({ ...base, phase: 'navigating', distanceToManeuverMeters: 25 }).guidanceUrgency).toBe('immediate');
  });

  it('suppresses lane guidance when confidence is too low', () => {
    const visual = deriveNavigationVisualState({ ...base, phase: 'navigating', distanceToManeuverMeters: 50, laneConfidence: 0.2 });
    expect(visual.laneGuidance).toBeNull();
  });

  it('shows a GPS warning during active navigation with weak GPS', () => {
    expect(deriveNavigationVisualState({ ...base, phase: 'navigating', gpsConfidence: 0.3 }).showGpsWarning).toBe(true);
    expect(deriveNavigationVisualState({ ...base, phase: 'navigating', gpsConfidence: 0.6 }).showGpsWarning).toBe(false);
  });
});
