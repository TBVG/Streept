# Streept Alpha 130 — Route-Ahead Scene Prefetch Pass

## Delivered
- Added `routeScenePrefetch.ts` for deterministic route-ahead bubble planning.
- Uses the driver's nearest route point as the forward origin.
- Prefetch horizon is bounded to ~1.1 km in the immersive view.
- Uses 220 m spacing and an eight-bubble cap to prevent request storms.
- Keeps targets on the route ahead rather than sampling behind the driver.
- Exposes stable scene-cache keys for deduplication.
- Integrated with existing `prefetchSceneContext()` so cached/persisted delivery remains reused.
- Added unit coverage for bounds, forward-only behavior, and deduplication.

## Separation guarantees
- Prefetch does not rebuild Cesium geometry.
- Prefetch does not mutate traffic entities.
- Prefetch does not alter navigation state.
- Active scene rendering still owns the currently visible bubble.

## Validation
- TypeScript source transpile validation should be run across all TS/TSX files.
- Full dependency-backed frontend build and Rust compilation remain Docker/dependency-environment checks.
