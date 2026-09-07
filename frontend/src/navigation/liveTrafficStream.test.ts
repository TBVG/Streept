import { describe, expect, it } from 'vitest';
import { LiveTrafficStream } from './liveTrafficStream';
import { Report, TrafficVehicle } from '../types';

const vehicle = (id: string, at: string, lane: number | null = 1): TrafficVehicle => ({
  id, location: { lat: 21.1458, lng: 79.0882 }, way_id: 101, segment_id: '101:2', lane_index: lane,
  speed_mps: 12, heading_degrees: 90, observed_at: at, confidence: 0.9, source: 'provider-test',
});

const report = (id: string, at: string, expires = '2026-09-05T17:00:00.000Z'): Report => ({
  id,
  type: 'traffic_jam',
  location: { lat: 21.1458, lng: 79.0882 },
  photo_url: null,
  reported_at: at,
  expires_at: expires,
  reporter_id: 'test',
  confirmations: 1,
  dismissals: 0,
  confidence: 0.9,
});

describe('live traffic stream', () => {
  it('converges REST snapshots and newer websocket deltas', () => {
    const stream = new LiveTrafficStream();
    stream.replace([report('a', '2026-09-05T16:00:00.000Z')], Date.parse('2026-09-05T16:01:00.000Z'));
    stream.ingest({ type: 'report_updated', report: report('a', '2026-09-05T16:02:00.000Z') }, Date.parse('2026-09-05T16:02:01.000Z'));
    stream.replace([report('a', '2026-09-05T16:01:30.000Z'), report('b', '2026-09-05T16:01:00.000Z')], Date.parse('2026-09-05T16:03:00.000Z'));
    expect(stream.snapshot().reports.map((r) => r.id)).toEqual(['a', 'b']);
    expect(stream.snapshot().reports[0].reported_at).toContain('16:02:00');
  });

  it('converges vehicle REST snapshots with websocket deltas and removals', () => {
    const stream = new LiveTrafficStream();
    stream.replaceVehicles([vehicle('v1', '2026-09-05T16:00:00.000Z')], Date.parse('2026-09-05T16:00:01.000Z'));
    stream.ingest({ type: 'traffic_vehicle_updated', vehicle: vehicle('v1', '2026-09-05T16:00:02.000Z', 2) }, Date.parse('2026-09-05T16:00:03.000Z'));
    stream.replaceVehicles([vehicle('v1', '2026-09-05T16:00:01.500Z'), vehicle('v2', '2026-09-05T16:00:02.000Z')], Date.parse('2026-09-05T16:00:04.000Z'));
    expect(stream.snapshot().vehicles.find((v) => v.id === 'v1')?.lane_index).toBe(2);
    expect(stream.snapshot().vehicles).toHaveLength(2);
    stream.ingest({ type: 'traffic_vehicle_removed', id: 'v1', location: vehicle('v1', '2026-09-05T16:00:02.000Z').location }, Date.parse('2026-09-05T16:00:05.000Z'));
    expect(stream.snapshot().vehicles.map((v) => v.id)).toEqual(['v2']);
  });

  it('expires stale vehicle telemetry instead of treating it as live occupancy', () => {
    const stream = new LiveTrafficStream({ vehicleStaleAfterMs: 5000 });
    stream.replaceVehicles([vehicle('v1', '2026-09-05T16:00:00.000Z')], Date.parse('2026-09-05T16:00:00.000Z'));
    expect(stream.snapshot(Date.parse('2026-09-05T16:00:06.000Z')).vehicles).toHaveLength(0);
  });

  it('removes websocket deletions and expires stale reports', () => {
    const stream = new LiveTrafficStream({ staleAfterMs: 60_000 });
    stream.replace([report('a', '2026-09-05T16:00:00.000Z')], Date.parse('2026-09-05T16:00:30.000Z'));
    stream.ingest({ type: 'report_removed', id: 'a', location: { lat: 21.1458, lng: 79.0882 } }, Date.parse('2026-09-05T16:00:40.000Z'));
    expect(stream.snapshot().reports).toHaveLength(0);
    stream.replace([report('b', '2026-09-05T16:01:00.000Z')], Date.parse('2026-09-05T16:01:10.000Z'));
    expect(stream.snapshot(Date.parse('2026-09-05T16:02:10.000Z')).reports).toHaveLength(0);
  });
});

