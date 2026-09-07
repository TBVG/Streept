# Streept Alpha 129 — Production 3D Scene Lifecycle

## Completed

- Added a renderer-neutral `sceneRenderLifecycle` plan with stable scene-object identities for roads, buildings, signals, crossings, stops, trees, lamps, and restrictions.
- Added deterministic scene-plan diffing so changed bubbles can be classified as added, removed, or unchanged instead of treating every scene as unrelated.
- Changed the Cesium immersive renderer to build replacement static geometry in a fresh `PrimitiveCollection` before swapping it into the live scene.
- Removed the previous `viewer.entities.removeAll()` scene-reset behavior. The driver vehicle and live traffic entities now survive static-scene swaps.
- Navigation guidance entities are retired only when a replacement scene is ready, preventing a blank guidance layer while an OSM bubble is loading.
- Added a generation guard so a late scene build cannot replace a newer scene.
- Scene lifecycle identity now includes the delivered scene bubble, fixing the earlier case where a new dynamic bubble could arrive while the route/maneuver key stayed unchanged.

## Validation

- 103 TypeScript/TSX source files transpile with zero diagnostics (ambient `vite-env.d.ts` excluded from this syntax-only check).
- ZIP integrity verified after packaging.
- Full dependency-backed `tsc`/Vite build is still not claimed because the archive intentionally does not include `node_modules` and the execution environment cannot complete the dependency installation reliably.
- Backend Rust compilation is not claimed in this environment because host `cargo`/`rustc` are unavailable; Docker remains the reproducible backend build path.

## Remaining lifecycle refinement

The current lifecycle swaps whole primitive collections rather than performing per-object Cesium primitive reuse. The renderer-neutral diff is now in place so true object-level reuse can be added without changing the scene delivery contract.

## Follow-on: Alpha 130 route-ahead prefetch
Alpha 130 adds a renderer-independent route-ahead scene prefetch planner. The immersive view now opportunistically warms bounded scene bubbles along the next ~1.1 km of the active route, with route spacing and maneuver-aware centers, while keeping the active scene lifecycle and telemetry paths separate.
