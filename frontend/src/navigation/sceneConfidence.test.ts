import { buildSceneConfidence } from './sceneConfidence';
import { buildSceneGuidancePlan } from './sceneGuidance';
import { Route3DHighlight, Maneuver } from '../types';

const route: Route3DHighlight = {
  segments: [{ coords: Array.from({ length: 20 }, (_, i) => ({ lat: 43 + i * 0.00005, lng: -78, alt: 0 })), is_highlighted: true, color: '#fff', lane_index: 1 }],
  maneuvers: [], duration_seconds: 100, distance_meters: 1000,
};
const maneuver: Maneuver = { type: 'turn', modifier: 'right', location: { lat: 43.0005, lng: -78 }, bearing_before: 0, instruction: 'Turn right', is_complex: false, lanes: [{ indications: ['right'], valid: true, recommended: true, confidence: 0.95 }] };

describe('buildSceneConfidence', () => {
  it('keeps high quality guidance visually authoritative', () => {
    const plan = buildSceneGuidancePlan(route, maneuver, 0, 0.96, null)!;
    const result = buildSceneConfidence(plan, 0.96, { lat: 43.0005, lng: -78 }, route, { buildings: [], roads: [{ geometry: route.segments[0].coords, highway: 'primary', name: 'Main', lanes: 2, oneway: true }], signals: [], crossings: [], stops: [], trees: [] });
    expect(result.overall).toBeGreaterThan(0.7);
    expect(result.guidanceAlpha).toBeGreaterThan(0.8);
  });

  it('reduces visual authority when lane confidence is poor', () => {
    const plan = buildSceneGuidancePlan(route, maneuver, 0, 0.25, null)!;
    const result = buildSceneConfidence(plan, 0.25, null, route, null);
    expect(result.overall).toBeLessThan(0.6);
    expect(result.branchAlpha).toBeLessThan(0.7);
  });
});
