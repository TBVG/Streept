import { describe, expect, it } from 'vitest';
import { deriveSpatialIntelligence } from './spatialIntelligence';
import { Location, Route3DHighlight, SceneContext } from '../types';

const origin: Location = { lat: 43.0000, lng: -78.0000 };
const scene: SceneContext = {
  buildings: [], signals: [{ lat: 43.0001, lng: -78.0000 }], crossings: [], stops: [], trees: [],
  roads: [{ osm_id: 42, geometry: [origin, { lat: 43.001, lng: -78.0000 }], highway: 'primary', name: 'Main St', lanes: 3, oneway: true, maxspeed: '40 mph' }],
};
const route: Route3DHighlight = {
  provider: 'osrm', duration_seconds: 100, distance_meters: 1000,
  segments: [{ coords: [{ ...origin, alt: 0 }, { lat: 43.001, lng: -78, alt: 0 }], is_highlighted: true, color: '#fff', lane_index: null }],
  maneuvers: [{ type: 'merge', modifier: 'right', location: { lat: 43.0005, lng: -78 }, bearing_before: 0, instruction: 'Merge right', is_complex: true }],
};

describe('spatial intelligence', () => {
  it('combines road, maneuver and local scene evidence', () => {
    const result = deriveSpatialIntelligence(origin, route, scene, 42);
    expect(result.roadClass).toBe('arterial');
    expect(result.roadName).toBe('Main St');
    expect(result.laneCount).toBe(3);
    expect(result.oneWay).toBe(true);
    expect(result.speedLimitKph).toBeCloseTo(64.37, 1);
    expect(result.maneuver).toBe('merge');
    expect(result.nearbySignals).toBe(1);
    expect(result.confidence).toBeGreaterThan(0.5);
  });


  it('keeps maneuver selection in route order when a passed maneuver is geographically closer', () => {
    const routeWithTwo: Route3DHighlight = {
      ...route,
      segments: [{ ...route.segments[0], coords: [
        { lat: 43.0000, lng: -78.0000, alt: 0 },
        { lat: 43.0005, lng: -78.0000, alt: 0 },
        { lat: 43.0010, lng: -78.0000, alt: 0 },
      ] }],
      maneuvers: [
        { type: 'turn', modifier: 'left', location: { lat: 43.00035, lng: -78.00002 }, bearing_before: 0, instruction: 'Turn left', is_complex: false },
        { type: 'turn', modifier: 'right', location: { lat: 43.00080, lng: -78.00000 }, bearing_before: 0, instruction: 'Turn right', is_complex: false },
      ],
    };
    const result = deriveSpatialIntelligence({ lat: 43.00065, lng: -78.00001 }, routeWithTwo, scene, 42);
    expect(result.nextManeuver?.instruction).toBe('Turn right');
    expect(result.maneuverDistanceMeters).toBeGreaterThan(0);
  });

  it('does not invent map facts without a scene', () => {
    const result = deriveSpatialIntelligence(origin, route, null, null);
    expect(result.roadClass).toBe('unknown');
    expect(result.roadName).toBeNull();
    expect(result.laneCount).toBeNull();
    expect(result.oneWay).toBeNull();
    expect(result.speedLimitKph).toBeNull();
  });
});


describe('deriveSpatialIntelligence road intelligence', () => {
  it('counts nearby reports and live traffic vehicles without changing the route facts', () => {
    const origin = { lat: 43.0001, lng: -78.0001 };
    const route = {
      provider: 'osrm' as const,
      segments: [{ coords: [origin, { lat: 43.001, lng: -78.001 }] }],
      maneuvers: [],
    };
    const result = deriveSpatialIntelligence(
      origin,
      route,
      null,
      null,
      [{ location: { lat: 43.0002, lng: -78.0001 } }],
      [{ location: { lat: 43.0003, lng: -78.0001 } }],
    );
    expect(result.nearbyReports).toBe(1);
    expect(result.nearbyTrafficVehicles).toBe(1);
    expect(result.roadClass).toBe('unknown');
  });
});
