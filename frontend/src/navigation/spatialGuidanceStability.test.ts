import { describe, expect, it } from 'vitest';
import { SpatialGuidanceStabilizer } from './spatialGuidanceStability';
import { SpatialGuidanceDecision } from './spatialGuidanceDecision';

const decision = (action: SpatialGuidanceDecision['action'], reason = action): SpatialGuidanceDecision => ({
  action,
  reason,
  confidence: 0.9,
  priority: action === 'high-alert' ? 'critical' : action === 'continue' ? 'normal' : 'elevated',
  targetSpeedMps: null,
});

describe('spatial guidance stability', () => {
  it('escalates immediately', () => {
    const stabilizer = new SpatialGuidanceStabilizer(900);
    stabilizer.update(decision('continue'), 0);
    expect(stabilizer.update(decision('high-alert'), 50).action).toBe('high-alert');
  });

  it('holds a downgrade briefly to prevent threshold flicker', () => {
    const stabilizer = new SpatialGuidanceStabilizer(900);
    stabilizer.update(decision('high-alert'), 0);
    expect(stabilizer.update(decision('prepare'), 200).action).toBe('high-alert');
    expect(stabilizer.update(decision('prepare'), 901).action).toBe('prepare');
  });

  it('lets uncertainty escalate immediately', () => {
    const stabilizer = new SpatialGuidanceStabilizer(900);
    stabilizer.update(decision('prepare'), 0);
    expect(stabilizer.update(decision('uncertain'), 10).action).toBe('uncertain');
  });
});
