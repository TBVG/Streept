import { describe, expect, it } from 'vitest';
import { deriveSpatialIntelligence } from './spatialIntelligence';

describe('spatial intersection topology', () => {
  it('prefers the planned next way over a nearby unrelated road', () => {
    const origin = { lat: 43, lng: -78 };
    const scene = {
      buildings: [], signals: [], crossings: [], stops: [], trees: [],
      roads: [
        { osm_id: 10, geometry: [origin, { lat: 43.0005, lng: -78 }], highway: 'primary', name: 'Incoming', lanes: 2, oneway: true },
        { osm_id: 20, geometry: [{ lat: 43.0005, lng: -78 }, { lat: 43.001, lng: -77.9995 }], highway: 'secondary', name: 'Planned Exit', lanes: 2, oneway: true },
        { osm_id: 30, geometry: [{ lat: 43.0005, lng: -78 }, { lat: 43.0005, lng: -77.9999 }], highway: 'tertiary', name: 'Nearby Distractor', lanes: 2, oneway: true },
      ],
    };
    const route = {
      provider: 'osrm' as const, duration_seconds: 30, distance_meters: 300,
      segments: [{ coords: [ { ...origin, alt: 0 }, { lat: 43.0005, lng: -78, alt: 0 }, { lat: 43.001, lng: -77.9995, alt: 0 }], is_highlighted: true }],
      maneuvers: [{ type: 'turn', modifier: 'right', location: { lat: 43.0005, lng: -78 }, bearing_before: 0, instruction: 'Turn right', is_complex: false }],
    };
    const result = deriveSpatialIntelligence({ lat: 43.0004, lng: -78 }, route, scene, 10, [], [], null, null, [10, 20]);
    expect(result.intersectionIntelligence.confidence).toBeGreaterThan(0.5);
  });
});
