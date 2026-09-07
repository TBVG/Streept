import { describe, expect, it } from 'vitest';
import { TrafficVehicle } from '../types';
import { toLaneOccupantObservation, toLaneOccupantObservations } from './trafficVehicleAdapter';

const vehicle = (overrides: Partial<TrafficVehicle> = {}): TrafficVehicle => ({
  id: 'v1',
  location: { lat: 21.1458, lng: 79.0882 },
  way_id: 101,
  segment_id: '101:2',
  lane_index: 1,
  speed_mps: 12,
  heading_degrees: 90,
  observed_at: '2026-09-05T16:00:00.000Z',
  confidence: 0.9,
  source: 'provider-test',
  ...overrides,
});

describe('traffic vehicle adapter', () => {
  const now = Date.parse('2026-09-05T16:00:05.000Z');

  it('maps fresh lane-aware telemetry to a lane occupant', () => {
    const occupant = toLaneOccupantObservation(vehicle(), now);
    expect(occupant?.id).toBe('v1');
    expect(occupant?.laneIndex).toBe(1);
    expect(occupant?.speedMps).toBe(12);
  });

  it('rejects stale or low-confidence telemetry', () => {
    expect(toLaneOccupantObservation(vehicle({ observed_at: '2026-09-05T15:59:30.000Z' }), now)).toBeNull();
    expect(toLaneOccupantObservation(vehicle({ confidence: 0.2 }), now)).toBeNull();
  });

  it('preserves vehicles without lane identity without inventing a lane', () => {
    const occupants = toLaneOccupantObservations([vehicle({ lane_index: null })], now);
    expect(occupants).toHaveLength(1);
    expect(occupants[0].laneIndex).toBeNull();
  });
});
