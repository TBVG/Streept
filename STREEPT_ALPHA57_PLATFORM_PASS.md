# Streept Alpha 57 — Integrated Navigation Platform Pass

Implemented directly on the Alpha 56 source.

## Offline-first persistence
- Added an IndexedDB navigation store for routes and immersive scene contexts.
- LocalStorage remains the synchronous fast path; IndexedDB acts as the larger persistent tier.
- Successful route/scene payloads are persisted asynchronously.
- Route and scene reads can recover from IndexedDB after refresh or transient network loss.

## Predictive maneuver experience
- Added a shared maneuver-experience decision model.
- Complexity, maneuver type, lane data, and vehicle speed influence prepare/immersive timing.
- The same decision can be reused by future native clients and the 3D renderer.

## Navigation behavior
- Immersive split-view triggering now uses the shared experience model rather than a single fixed-distance rule.
- Higher-speed/complex maneuvers get a larger preparation window.

## Verification
- Added regression tests for experience scoring and speed-adaptive preloading.
