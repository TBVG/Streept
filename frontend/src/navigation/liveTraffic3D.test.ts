import { buildLiveTraffic3D } from './liveTraffic3D';
import { SceneContext, TrafficVehicle } from '../types';

const vehicle = (overrides: Partial<TrafficVehicle> = {}): TrafficVehicle => ({
  id: 'v1', location: { lat: 0, lng: 0.0005 }, way_id: null, segment_id: null, lane_index: null,
  speed_mps: 10, heading_degrees: null, observed_at: new Date(100_000).toISOString(), confidence: 0.9, source: 'test', ...overrides,
});

const scene: SceneContext = {
  buildings: [], signals: [], crossings: [], stops: [], trees: [], restrictions: [],
  roads: [{ osm_id: 10, node_ids: [1, 2], geometry: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.002 }], highway: 'primary', name: 'Test', lanes: 2, oneway: true, oneway_reverse: false }],
};

test('renders fresh vehicles and preserves GPS location without lane identity', () => {
  const result = buildLiveTraffic3D([vehicle()], { lat: 0, lng: 0 }, null, { nowMs: 105_000 });
  expect(result).toHaveLength(1);
  expect(result[0].laneSnapped).toBe(false);
});

test('drops stale and low-confidence vehicles', () => {
  const result = buildLiveTraffic3D([
    vehicle({ id: 'stale', observed_at: new Date(70_000).toISOString() }),
    vehicle({ id: 'weak', confidence: 0.1 }),
  ], { lat: 0, lng: 0 }, null, { nowMs: 105_000 });
  expect(result).toHaveLength(0);
});

test('snaps a lane-positioned vehicle to the physical lane centerline', () => {
  const result = buildLiveTraffic3D([vehicle({ way_id: 10, lane_index: 0 })], { lat: 0, lng: 0 }, scene, { nowMs: 105_000 });
  expect(result).toHaveLength(1);
  expect(result[0].laneSnapped).toBe(true);
  expect(result[0].wayId).toBe(10);
});

test('caps render candidates deterministically', () => {
  const vehicles = Array.from({ length: 8 }, (_, i) => vehicle({ id: `v${i}`, location: { lat: 0, lng: 0.0001 + i * 0.00001 } }));
  const result = buildLiveTraffic3D(vehicles, { lat: 0, lng: 0 }, null, { nowMs: 105_000, maxVehicles: 3 });
  expect(result).toHaveLength(3);
});
