# Streept Alpha 147 — Uncertainty-Aware Scene Composition

## Goal
Coordinate confidence, recovery, guidance trust, and streamed world context into one visual composition policy.

## Completed
- Added `frontend/src/navigation/sceneComposition.ts`.
- Classifies driver lane, junction branch, route continuity, OSM world, traffic, infrastructure, billboard, and recovery layers.
- Keeps authoritative guidance visually dominant while reducing uncertain world detail without removing useful context.
- Applies bounded world-detail limits and opacity to streamed buildings, roads, infrastructure, and roadside billboards.
- Uses actual user location in lane guidance confidence calculations.
- Fixed the guidance transition smoother wiring so driver-first and lane guidance share the same smoothing ref.
- Added deterministic composition tests covering trusted, degraded-GPS, and stale-scene states.

## Validation
- 131+ TypeScript/TSX files syntax/transpile checked with zero diagnostics (excluding the ambient `vite-env.d.ts` declaration file).
- ZIP integrity verified.
- Full dependency-backed Vite typecheck/build and Rust compilation were not claimed because this environment does not have the project's installed frontend dependencies or Cargo.
