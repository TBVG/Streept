# Streept Alpha 88 — Route-wide OSM Restriction Graph

## Completed
- Added deterministic mapping from route samples to nearby OSM scene way IDs.
- Added ordered route-way restriction evaluation using the Alpha 86/87 `from -> via -> to` relation model.
- Integrated restriction legality into route-wide lane planning and actionable lane-change windows.
- Scene guidance can now consume the same restriction-aware lane route plan used by the 3D layer.
- Definite OSM prohibitions mark affected lane-route steps unreachable instead of merely drawing an unsafe lane transition.
- Ambiguous/missing restriction coverage remains confidence-weighted and does not invent prohibitions.
- Added regression coverage for route-to-scene way sequence derivation.

## Validation
- Frontend TypeScript source transpile validation: 0 failures.
- ZIP integrity validation: passed.
- Rust compilation was not run in the host environment because Cargo/rustc are unavailable there; Docker's Rust builder remains the reproducible backend build environment.

## Remaining for the next pass
- Improve route-to-way matching from vertex-nearest to segment-level map matching.
- Carry explicit way sequence/state through `NavigationEngine` rather than deriving it repeatedly from scene samples.
- Validate lane transitions against restriction-aware route state at every maneuver and reroute boundary.
