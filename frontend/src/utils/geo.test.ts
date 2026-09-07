import { describe, it, expect } from 'vitest';
import {
  haversineDistanceMeters,
  destinationPoint,
  bearingDegrees,
  projectOntoPolyline,
} from './geo';
import { Location } from '../types';

/** Explicit absolute-tolerance comparison for meter-scale values, rather
 * than relying on toBeCloseTo's negative-precision behavior (which varies
 * subtly enough between Jest/Vitest versions that it's not worth trusting
 * blind here). */
function expectWithinMeters(actual: number, expected: number, toleranceMeters: number) {
  const diff = Math.abs(actual - expected);
  expect(diff, `expected ${actual} to be within ${toleranceMeters}m of ${expected}, off by ${diff}`).toBeLessThan(
    toleranceMeters
  );
}

describe('haversineDistanceMeters', () => {
  it('returns 0 for identical points', () => {
    const p: Location = { lat: 37.7749, lng: -122.4194 };
    expect(haversineDistanceMeters(p, p)).toBeCloseTo(0, 6);
  });

  it('matches the exact great-circle distance for 1 degree of longitude at the equator', () => {
    // At the equator, dLat=0 so the haversine formula reduces exactly to
    // R * dLng(radians) — a case we can compute independently rather than
    // just re-deriving the function's own formula.
    const a: Location = { lat: 0, lng: 0 };
    const b: Location = { lat: 0, lng: 1 };
    const expectedMeters = 6371000 * (Math.PI / 180);
    expectWithinMeters(haversineDistanceMeters(a, b), expectedMeters, 5);
  });

  it('roughly matches the known real-world SF-to-LA great-circle distance', () => {
    // Independent sanity check against a commonly-cited real value
    // (~559 km), not derived from the implementation itself.
    const sf: Location = { lat: 37.7749, lng: -122.4194 };
    const la: Location = { lat: 34.0522, lng: -118.2437 };
    const distance = haversineDistanceMeters(sf, la);
    expect(distance).toBeGreaterThan(550_000);
    expect(distance).toBeLessThan(570_000);
  });

  it('is symmetric', () => {
    const a: Location = { lat: 10, lng: 20 };
    const b: Location = { lat: 15, lng: 25 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });
});

describe('bearingDegrees', () => {
  const origin: Location = { lat: 0, lng: 0 };

  it('is ~0 for due north', () => {
    expect(bearingDegrees(origin, { lat: 1, lng: 0 })).toBeCloseTo(0, 1);
  });

  it('is ~90 for due east', () => {
    expect(bearingDegrees(origin, { lat: 0, lng: 1 })).toBeCloseTo(90, 1);
  });

  it('is ~180 for due south', () => {
    expect(bearingDegrees(origin, { lat: -1, lng: 0 })).toBeCloseTo(180, 1);
  });

  it('is ~270 for due west', () => {
    expect(bearingDegrees(origin, { lat: 0, lng: -1 })).toBeCloseTo(270, 1);
  });

  it('always returns a value in [0, 360)', () => {
    // Bearing math is a classic source of off-by-sign / wraparound bugs —
    // sample a spread of directions and confirm the range invariant holds.
    const points: Location[] = [
      { lat: 5, lng: 5 },
      { lat: -5, lng: 5 },
      { lat: -5, lng: -5 },
      { lat: 5, lng: -5 },
    ];
    for (const p of points) {
      const b = bearingDegrees(origin, p);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe('destinationPoint', () => {
  it('round-trips with bearingDegrees and haversineDistanceMeters', () => {
    // Implementation-independent correctness check: moving from an origin
    // by (bearing, distance) should land somewhere that, measured back
    // against the origin, has that same bearing and distance — this holds
    // regardless of the internal formula, so it isn't just re-testing the
    // function against itself.
    const origin: Location = { lat: 37.7749, lng: -122.4194 };
    const cases: Array<[number, number]> = [
      [0, 100],
      [90, 250],
      [180, 50],
      [270, 1000],
      [45, 500],
    ];

    for (const [bearing, distance] of cases) {
      const dest = destinationPoint(origin, bearing, distance);
      expectWithinMeters(haversineDistanceMeters(origin, dest), distance, 10);
      // Bearing wraps at 0/360 — compare via the shorter angular difference.
      const measuredBearing = bearingDegrees(origin, dest);
      const diff = Math.min(
        Math.abs(measuredBearing - bearing),
        360 - Math.abs(measuredBearing - bearing)
      );
      expect(diff).toBeLessThan(1);
    }
  });

  it('returns the origin unchanged for zero distance', () => {
    const origin: Location = { lat: 10, lng: 20 };
    const dest = destinationPoint(origin, 90, 0);
    expect(dest.lat).toBeCloseTo(origin.lat, 6);
    expect(dest.lng).toBeCloseTo(origin.lng, 6);
  });
});

describe('projectOntoPolyline', () => {
  // Constructed at the equator specifically so degree-to-meter conversion
  // is simple and predictable (lng: 111320 m/degree, lat: 110540 m/degree
  // at lat=0 — matching the constants projectOntoPolyline itself uses),
  // isolating the test to the projection/geometry logic rather than also
  // second-guessing the degree/meter conversion.
  const LNG_M_PER_DEG = 111320;
  const LAT_M_PER_DEG = 110540;

  it('returns null for a polyline with fewer than 2 points', () => {
    expect(projectOntoPolyline({ lat: 0, lng: 0 }, [])).toBeNull();
    expect(projectOntoPolyline({ lat: 0, lng: 0 }, [{ lat: 0, lng: 0 }])).toBeNull();
  });

  it('places a point on a straight segment at the correct along-distance with ~0 lateral offset', () => {
    const start: Location = { lat: 0, lng: 0 };
    const end: Location = { lat: 0, lng: 0.01 }; // due east, ~1113.2m
    const midpoint: Location = { lat: 0, lng: 0.005 };

    const result = projectOntoPolyline(midpoint, [start, end]);
    expect(result).not.toBeNull();
    expectWithinMeters(result!.distanceFromLineMeters, 0, 1);
    expectWithinMeters(result!.distanceAlongMeters, 0.005 * LNG_M_PER_DEG, 10);
    expect(result!.segmentIndex).toBe(0);
  });

  it('measures lateral offset for a point off to the side of the line', () => {
    const start: Location = { lat: 0, lng: 0 };
    const end: Location = { lat: 0, lng: 0.01 };
    const offsetNorth: Location = { lat: 0.001, lng: 0.005 };

    const result = projectOntoPolyline(offsetNorth, [start, end]);
    expect(result).not.toBeNull();
    expectWithinMeters(result!.distanceFromLineMeters, 0.001 * LAT_M_PER_DEG, 10);
    // Still projects to the same along-position as the point directly below it.
    expectWithinMeters(result!.distanceAlongMeters, 0.005 * LNG_M_PER_DEG, 10);
  });

  it('clamps to the segment endpoint rather than extrapolating beyond it', () => {
    const start: Location = { lat: 0, lng: 0 };
    const end: Location = { lat: 0, lng: 0.01 };
    const wayPastEnd: Location = { lat: 0, lng: 0.05 };

    const result = projectOntoPolyline(wayPastEnd, [start, end]);
    expect(result).not.toBeNull();
    // Should clamp to `end` (t=1), i.e. the full segment length, not
    // whatever the raw unclamped projection would give.
    expectWithinMeters(result!.distanceAlongMeters, 0.01 * LNG_M_PER_DEG, 10);
  });

  it('picks the correct segment across a multi-segment (L-shaped) polyline', () => {
    const p0: Location = { lat: 0, lng: 0 };
    const p1: Location = { lat: 0, lng: 0.01 }; // east leg, ~1113.2m
    const p2: Location = { lat: 0.01, lng: 0.01 }; // north leg from p1, ~1105.4m

    // A point on the second (north-south) leg, past the corner.
    const onSecondLeg: Location = { lat: 0.005, lng: 0.01 };

    const result = projectOntoPolyline(onSecondLeg, [p0, p1, p2]);
    expect(result).not.toBeNull();
    expect(result!.segmentIndex).toBe(1);
    expectWithinMeters(result!.distanceFromLineMeters, 0, 1);

    const expectedAlong = 0.01 * LNG_M_PER_DEG + 0.005 * LAT_M_PER_DEG;
    expectWithinMeters(result!.distanceAlongMeters, expectedAlong, 10);
  });
});
