# Streept Alpha 128 — Dynamic Immersive Scene Streaming

Alpha 128 moves the immersive renderer from a maneuver-only scene fetch toward a user-centered scene bubble.

## What changed
- Added `sceneBubbleStreaming.ts` as the renderer-independent delivery controller.
- Scene bubbles refresh only after the driver moves 120 m by default, avoiding a network request for every GPS fix.
- Existing `SceneBubbleCache` provides bounded TTL/LRU reuse.
- Request generations prevent a late response from an older location replacing a newer scene.
- `ImmersiveTurnView` now requests a user-centered 220 m scene bubble when the driver moves far enough.
- Live traffic synchronization remains separate from static scene rebuilding.

## Safety/performance behavior
- A missing scene does not block the route or driver camera.
- Cached scene data is reused when available.
- Telemetry updates do not rebuild OSM geometry.
- No external 3D tile provider or API key is introduced.

## Validation
- Added regression tests for refresh thresholds, cache behavior, and stale-request cancellation.
