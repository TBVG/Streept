# Streept Alpha 73 — Framework-Neutral Navigation Core

## Goal
Separate navigation runtime responsibilities from the React renderer so the same navigation logic can be reused by web, native, test, or future 3D clients.

## Delivered
- Added `frontend/src/navigation/navigationEngine.ts`.
- `NavigationEngine` owns:
  - typed navigation lifecycle transitions
  - route indexing and route-aware GPS matching
  - GPS fix plausibility checks
  - speed/heading fallback derivation
  - short-horizon GPS continuity/dead reckoning
  - navigation health, progress, and ETA queries
  - renderer-neutral snapshots
- `NavigationView.tsx` now delegates GPS acceptance/matching and continuity ticks to the engine while retaining React state strictly as the view adapter.
- Added `navigationEngine.test.ts` covering lifecycle/matching, implausible jumps, and GPS-gap continuity.

## Architecture
`NavigationView` is now a renderer adapter around a framework-neutral navigation runtime. The engine has no React, Leaflet, Cesium, DOM, or browser API dependency.

## Validation
- New/changed TypeScript sources were transpile-checked with the repository's available TypeScript compiler.
- ZIP integrity checked with `unzip -t`.
- Full dependency install/build remains environment-limited because the archive does not include `node_modules`; backend Rust compilation is also unavailable in the current container because Cargo is not installed.

## Remaining
The core can now be separated further if needed, but the next high-value work is deeper 3D scene/navigation integration and production performance/hardening rather than another large React refactor.
