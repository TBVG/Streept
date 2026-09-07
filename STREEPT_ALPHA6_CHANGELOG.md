# Streept Alpha 6 — Navigation Core

## Product-grade changes

- Added a dedicated navigation core module with explicit navigation phases.
- Added GPS smoothing before rendering driver position.
- Added route-aware client-side map matching and monotonic route progress.
- Added destination-radius arrival detection and a clean arrival state.
- Removed the hidden MapLibre 3D renderer and its duplicate WebGL lifecycle. Cesium is now the single immersive renderer.
- Increased Cesium terrain fidelity and added hardware-aware high-DPI rendering.
- Added navigation-core unit tests.
- Removed the fixed San Francisco fallback when GPS fails; the product no longer invents a driver location.

## Architecture

`GPS → smoothing → route matching → progress → maneuver intelligence → Cesium immersive scene`

The routing provider remains replaceable so the prototype can later move from public routing infrastructure to a Streept-owned routing/scene stack.
