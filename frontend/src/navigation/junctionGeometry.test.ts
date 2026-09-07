import { buildJunctionConnector } from './junctionGeometry';
import { Maneuver, RouteCoord } from '../types';

const p = (lat: number, lng: number): RouteCoord => ({ lat, lng, alt: 0 });
const maneuver: Maneuver = { type: 'turn', modifier: 'right', location: { lat: 0, lng: 0 }, bearing_before: 0, instruction: 'Turn right', is_complex: false };

describe('junction geometry', () => {
  it('creates a smooth connector without a single artificial midpoint', () => {
    const result = buildJunctionConnector([p(0, -0.001), p(0, 0)], [p(0.001, 0), p(0.002, 0)], maneuver, 'turn');
    expect(result.points.length).toBeGreaterThan(10);
    expect(result.lengthMeters).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('uses a sampled circular arc for a roundabout instead of a generic turn curve', () => {
    const result = buildJunctionConnector(
      [p(0, -0.001), p(0, 0)],
      [p(0.001, 0.001), p(0.0018, 0.0018)],
      { ...maneuver, type: 'roundabout', modifier: 'right' },
      'roundabout',
    );
    expect(result.kind).toBe('roundabout');
    expect(result.points.length).toBeGreaterThan(14);
    expect(result.lengthMeters).toBeGreaterThan(0);
  });
});
