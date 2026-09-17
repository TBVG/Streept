import { describe, expect, it } from 'vitest';
import { SpatialObservationLedger } from './observationLedger';
import { SpatialIntelligenceSnapshot } from './spatialIntelligence';

const spatial: SpatialIntelligenceSnapshot = {
  roadClass: 'arterial', roadName: 'Main', wayId: 42, laneCount: 2, oneWay: true,
  speedLimitKph: 50, maneuver: 'turn', maneuverDistanceMeters: 10,
  nextManeuver: { type: 'turn', modifier: 'right', location: { lat: 1, lng: 2 }, bearing_before: 0, instruction: 'Turn right', is_complex: false },
  nearbySignals: 1, nearbyCrossings: 0, nearbyStops: 0, nearbyReports: 0, nearbyTrafficVehicles: 0,
  hazardIntelligence: { level: 'none', confidence: 0.9, nearbyHazards: 0, nearbyClosedLanes: 0 },
  laneIntelligence: { currentLaneIndex: 0, recommendedLaneIndices: [1], laneAlignment: 'misaligned', laneChangeDirection: 'right', requiredLaneChanges: 1, confidence: 0.9 },
  confidence: 0.9,
};

describe('spatial observation ledger', () => {
  it('stores coarse maneuver outcomes without raw GPS', () => {
    const ledger = new SpatialObservationLedger(() => 123);
    ledger.recordManeuverOutcome({ status: 'completed', maneuverKey: 'turn|right|1|2', instruction: 'Turn right', laneCompliant: true, distanceAtEvaluationMeters: 40, completedCount: 1, missedCount: 0 }, spatial, 3);
    const result = ledger.snapshot()[0];
    expect(result.type).toBe('maneuver_completed');
    expect(result.wayId).toBe(42);
    expect(result.routeGeneration).toBe(3);
    expect(result).not.toHaveProperty('location');
    expect(result).not.toHaveProperty('lat');
    expect(result).not.toHaveProperty('lng');
  });

  it('ignores tracking outcomes', () => {
    const ledger = new SpatialObservationLedger();
    ledger.recordManeuverOutcome({ status: 'tracking', maneuverKey: 'x', instruction: 'x', laneCompliant: null, distanceAtEvaluationMeters: 20, completedCount: 0, missedCount: 0 }, spatial, 1);
    expect(ledger.snapshot()).toHaveLength(0);
  });
});


describe('SpatialObservationLedger cloud sync', () => {
  it('uploads pending observations and marks them synced', async () => {
    const ledger = new SpatialObservationLedger(() => 1000);
    ledger.recordHazard(spatial, 4);
    expect(ledger.pending()).toHaveLength(1);
    const sent: SpatialObservation[] = [];
    const uploaded = await ledger.flushToCloud(async (batch) => { sent.push(...batch); }, 50);
    expect(uploaded).toBe(1);
    expect(sent).toHaveLength(1);
    expect(ledger.pending()).toHaveLength(0);
    expect(ledger.snapshot()[0].syncedAt).toBe(1000);
  });

  it('keeps observations pending when upload fails', async () => {
    const ledger = new SpatialObservationLedger(() => 1000);
    ledger.recordHazard(spatial, 5);
    const uploaded = await ledger.flushToCloud(async () => { throw new Error('offline'); });
    expect(uploaded).toBe(0);
    expect(ledger.pending()).toHaveLength(1);
  });
});
