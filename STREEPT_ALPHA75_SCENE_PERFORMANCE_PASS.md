# Streept Alpha 75 — Immersive Scene Performance Pass

## Goal
Make the 3D navigation scene predictable on dense urban OSM bubbles and longer routes without changing the navigation behavior or server payload contract.

## Changes
- Added `frontend/src/navigation/scenePerformance.ts` with deterministic camera-local scene budgets.
- Dense scene collections are now prioritized by distance to the upcoming maneuver before rendering.
- Added explicit budgets for roads, buildings, trees, lamps, signals, crossings, and stops.
- Added route geometry sampling stride selection so long routes do not generate excessive corridor geometry.
- Integrated the budget and stride policies into `ImmersiveTurnView`.
- Added deterministic unit tests for scene budgets and route sampling.

## Result
The immersive renderer now has a bounded client-side geometry/entity workload even when the backend returns a dense city-center bubble. This is a performance guardrail, not a substitute for future GPU/device profiling.

## Validation
- Changed TypeScript modules transpile/syntax-check successfully with the installed TypeScript compiler.
- ZIP integrity checked with `unzip -t`.
- Full dependency installation/build was not run because the archive has no `node_modules` and dependency installation is network/time constrained.
- Rust compilation remains unavailable in this environment because `cargo` is not installed.
