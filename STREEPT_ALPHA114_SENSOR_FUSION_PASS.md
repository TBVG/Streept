# Streept Alpha 114 — GPS + Sensor-Fusion Hardening

## Goal
Make live navigation motion estimates more stable during noisy GPS, urban-canyon drift and short GPS outages without pretending to implement a certified inertial-navigation system.

## Implemented
- Added a renderer-independent `fuseMotion` layer.
- Combines GPS speed/heading with optional device motion samples.
- Rejects stale motion samples and clamps physically implausible values.
- Uses GPS accuracy to decide when motion data should receive more weight.
- Computes motion confidence from GPS quality and sensor agreement.
- NavigationEngine now consumes the fused speed/heading path.
- Exposes `motionConfidence` in the engine snapshot.
- Keeps dead-reckoning as a short-horizon fallback rather than treating it as fresh GPS.

## Boundary
This is intentionally a lightweight browser-safe fusion heuristic, not a calibrated IMU/INS or safety-certified vehicle estimator. Device-specific sensor calibration and platform sensor APIs remain future integration work.
