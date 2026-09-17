import { describe, expect, it } from 'vitest';
import { deriveSpatialHazardIntelligence } from './spatialHazardIntelligence';

describe('spatial hazard intelligence', () => {
  const location = { lat: 1, lng: 1 };

  it('promotes an observed accident to critical', () => {
    const result = deriveSpatialHazardIntelligence([{ location, type: 'accident', confidence: 0.9 }]);
    expect(result.level).toBe('critical');
    expect(result.nearbyCriticalReports).toBe(1);
  });

  it('tracks closed lanes separately', () => {
    const result = deriveSpatialHazardIntelligence([{ location, type: 'closed_lane', confidence: 0.8 }]);
    expect(result.level).toBe('critical');
    expect(result.nearbyClosedLanes).toBe(1);
  });

  it('keeps traffic jams elevated rather than inventing a critical hazard', () => {
    const result = deriveSpatialHazardIntelligence([{ location, type: 'traffic_jam', confidence: 0.7 }]);
    expect(result.level).toBe('elevated');
    expect(result.nearbyCriticalReports).toBe(0);
  });
});
