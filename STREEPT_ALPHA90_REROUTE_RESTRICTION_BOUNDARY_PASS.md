# Streept Alpha 90 — Reroute Restriction Boundary Validation

## Goal
Make rerouting a hard navigation-topology boundary so stale OSM way history cannot contaminate the new route, while retaining a separate planned route topology for validation and preserving trusted GPS topology across scene refreshes.

## Delivered
- Added a monotonically increasing `routeGeneration` to `NavigationEngine`.
- `setRoute()` now clears traversed OSM way state and rebuilds a separate planned way sequence.
- Added `plannedWaySequence` and `plannedRestrictionStatus` to the engine snapshot.
- Route replacement therefore cannot reuse the previous route's `from -> via -> to` restriction prefix.
- Scene refreshes recompute planned topology but retain the active GPS way/history.
- Existing traveled restriction status remains based only on actually traversed way history.
- Added regression coverage for route replacement and scene refresh behavior.

## Validation
Frontend navigation TypeScript was syntax/transpile checked. Full Rust compilation remains a Docker-only validation step in the current execution environment because Cargo is not installed on the host.
