# Alpha 121 — Route Geometry + Persistent Traffic Replay

## Scope

This pass replaces the Alpha 120 replay's synthetic maneuver geometry and one-frame blocker observations with route-derived geometry and deterministic persistent vehicle tracks.

## Implemented

- Maneuver positions can now be supplied as real route `Location` values; replay resolves them to cumulative route distance.
- Existing explicit maneuver distances remain supported for deterministic fixtures.
- Lane-change trajectories are generated from the active replay route geometry instead of a fixed synthetic road.
- Persistent vehicle tracks can move along the active route with their own speed, start/end visibility, and deterministic lane changes.
- Existing blocker windows remain supported for focused maneuver tests.
- Junction maneuvers now resolve a physical incoming/outgoing road pair through the existing complex-junction lane resolver.
- Reroute replay switches the active truth route, resets truth progress to the replacement route, and records the engine route generation change.
- GPS dropout remains part of the same replay timeline.

## Validation

- TypeScript/TSX transpile validation: 93 files, 0 diagnostics.
- ZIP integrity checked after packaging.
- Full dependency-backed Vitest/Vite build was not run because this workspace does not contain `node_modules`.
- Rust compilation remains Docker-dependent because the host validation environment has no Cargo/Rust toolchain.

## Remaining direction

The next refinement should replace replay-created route roads with the actual scene roads/lane topology from live route context, and make traffic tracks junction-aware across real OSM way transitions rather than route-polyline interpolation alone.
