import { fuseMotion } from './sensorFusion';

describe('sensor fusion', () => {
  const location = { lat: 21, lng: 79 };
  it('fuses agreeing GPS and motion speed', () => {
    const result = fuseMotion({ location, previousLocation: { lat: 20.9999, lng: 79 }, previousTimestampMs: 1000, timestampMs: 1100, gpsSpeedMps: 10, gpsHeadingDegrees: 90, gpsAccuracyMeters: 5, motion: { timestampMs: 1100, speedMps: 10.5, headingDegrees: 92 } });
    expect(result.speedMps).toBeGreaterThan(10);
    expect(result.source).toBe('fused');
    expect(result.confidence).toBeGreaterThan(0.7);
  });
  it('falls back to motion when GPS accuracy is poor', () => {
    const result = fuseMotion({ location, previousLocation: null, previousTimestampMs: null, timestampMs: 2000, gpsSpeedMps: 24, gpsHeadingDegrees: 180, gpsAccuracyMeters: 30, motion: { timestampMs: 2000, speedMps: 12, headingDegrees: 178 } });
    expect(result.speedMps).toBe(12);
    expect(result.source).toBe('motion');
  });
  it('rejects stale motion samples', () => {
    const result = fuseMotion({ location, previousLocation: null, previousTimestampMs: 1000, timestampMs: 1100, gpsSpeedMps: 8, motion: { timestampMs: 9000, speedMps: 30 } });
    expect(result.speedMps).toBe(8);
    expect(result.source).toBe('gps');
  });
  it('clamps extreme motion values', () => {
    const result = fuseMotion({ location, previousLocation: null, previousTimestampMs: null, timestampMs: 1000, motion: { timestampMs: 1000, speedMps: 200, headingDegrees: 720, accelerationMps2: 40 } });
    expect(result.speedMps).toBe(55);
    expect(result.headingDegrees).toBe(0);
    expect(result.accelerationMps2).toBe(12);
  });
});
