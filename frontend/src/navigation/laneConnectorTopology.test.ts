import { describe, expect, it } from 'vitest';
import { buildLaneConnectorTopology } from './laneConnectorTopology';
import { Maneuver, RouteCoord } from '../types';

const coords: RouteCoord[] = [
  { lat: 0, lng: 0, alt: 0 }, { lat: 0.001, lng: 0, alt: 0 },
  { lat: 0.002, lng: 0.0002, alt: 0 }, { lat: 0.0025, lng: 0.0008, alt: 0 },
];
const maneuver: Maneuver = {
  type: 'turn', modifier: 'right', location: { lat: 0.002, lng: 0.0002 }, bearing_before: 0,
  instruction: 'Turn right', is_complex: false,
  lanes: [
    { indications: ['through'], valid: true },
    { indications: ['right'], valid: true, recommended: true },
  ],
};

describe('lane connector topology', () => {
  it('creates a renderer-ready connector from the trusted lane to the maneuver lane', () => {
    const topology = buildLaneConnectorTopology(coords, maneuver, 0, 2, 0, 1);
    expect(topology.connectors).toHaveLength(1);
    expect(topology.connectors[0].kind).toBe('change');
    expect(topology.connectors[0].points).toHaveLength(3);
    expect(topology.connectors[0].source).toBe('inferred-lane-geometry');
  });

  it('does not invent a driver lane when the current lane is unknown', () => {
    const topology = buildLaneConnectorTopology(coords, maneuver, 0, 2, null, 1);
    expect(topology.connectors[0].fromLane).toBe(1);
    expect(topology.connectors[0].toLane).toBe(1);
    expect(topology.connectors[0].confidence).toBeLessThan(0.8);
  });
});
