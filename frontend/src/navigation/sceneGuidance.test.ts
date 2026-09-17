import { describe, expect, it } from 'vitest';
import { buildSceneGuidancePlan, laneCenterOffsetMeters } from './sceneGuidance';
import { Maneuver, Route3DHighlight } from '../types';

const route: Route3DHighlight = {
  segments: [{ is_highlighted: true, color: '#fff', lane_index: null, coords: [
    { lat: 0, lng: 0, alt: 0 }, { lat: 0.001, lng: 0, alt: 0 }, { lat: 0.002, lng: 0, alt: 0 },
    { lat: 0.003, lng: 0, alt: 0 }, { lat: 0.004, lng: 0.001, alt: 0 }, { lat: 0.004, lng: 0.002, alt: 0 },
  ]}], maneuvers: [], duration_seconds: 60, distance_meters: 500,
};
const maneuver: Maneuver = {
  type: 'turn', modifier: 'right', location: { lat: 0.004, lng: 0.001 }, bearing_before: 0,
  instruction: 'Turn right', is_complex: false,
  lanes: [
    { indications: ['through'], valid: true, change: 'not:right' },
    { indications: ['right'], valid: true, recommended: true },
  ],
};

describe('scene guidance', () => {
  it('creates a maneuver-local 3D guidance window', () => {
    const plan = buildSceneGuidancePlan(route, maneuver, 0, 0.9);
    expect(plan).not.toBeNull();
    expect(plan!.maneuverIndex).toBe(4);
    expect(plan!.routeStartIndex).toBeLessThan(plan!.maneuverIndex);
    expect(plan!.routeEndIndex).toBeGreaterThan(plan!.maneuverIndex);
    expect(plan!.laneCount).toBe(2);
  });

  it('keeps lane offsets symmetric around the route center', () => {
    expect(laneCenterOffsetMeters(0, 2)).toBeCloseTo(-1.65);
    expect(laneCenterOffsetMeters(1, 2)).toBeCloseTo(1.65);
  });
});


it('stages the physical lane trajectory while retaining final lane intent', () => {
  const route = {
    provider: 'osrm' as const,
    segments: [{ coords: [
      { lat: 0, lng: 0, alt: 0 },
      { lat: 0, lng: 0.001, alt: 0 },
      { lat: 0, lng: 0.002, alt: 0 },
    ] }],
    maneuvers: [],
  } as any;
  const maneuver = {
    type: 'turn', modifier: 'right', location: { lat: 0, lng: 0.001, alt: 0 },
    bearing_before: 0, instruction: 'Turn right', is_complex: false,
    lanes: [{ recommended: false }, { recommended: false }, { recommended: true }],
  } as any;
  const scene = { roads: [{ osm_id: 1, geometry: [
    { lat: 0, lng: 0 }, { lat: 0, lng: 0.003 },
  ], lanes: 3 }] } as any;
  const plan = buildSceneGuidancePlan(route, maneuver, 0, 0.95, scene, 1);
  expect(plan?.targetLaneIndex).toBe(2);
  expect(plan?.laneChangeTrajectory?.sourceLane).toBe(0);
  expect(plan?.laneChangeTrajectory?.targetLane).toBe(1);
});
