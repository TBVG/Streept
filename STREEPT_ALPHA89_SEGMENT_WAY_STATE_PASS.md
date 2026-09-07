# Streept Alpha 89 — Segment-level OSM Way Matching & Persistent Way State

## Goal
Make OSM way identity a first-class navigation runtime signal rather than a one-off route-sample approximation.

## Implemented
- Added `sceneWayMatcher.ts` with point-to-polyline-segment OSM way matching.
- Route-to-way derivation now evaluates actual road segments, not only OSM geometry vertices.
- Added continuity preference so parallel/adjacent carriageways are less likely to steal a GPS match during noise.
- `NavigationEngine` now accepts a `SceneContext` and persistently tracks `currentWayId` plus an ordered recent `waySequence`.
- GPS fixes and dead-reckoned fixes update the way state without requiring React, Leaflet, or Cesium.
- Route changes rebuild the scene-way baseline when scene data is already attached; scene attachment can also rebuild the route sequence after a late scene fetch.
- Navigation snapshots expose current OSM way identity, recent way history, and restriction evaluation status.
- Existing restriction evaluation continues to use the persistent way history for multi-way `from -> via -> to` relations.
- Added regression tests for segment matching and persistent engine way transitions.

## Safety model
- Way history advances only when a new segment match is accepted; noisy GPS cannot arbitrarily rewrite history.
- A route or scene reset clears the active way state.
- Missing scene coverage never fabricates an OSM way ID.
- Restriction confidence remains separate from GPS confidence.

## Validation
- Frontend TypeScript transpile validation: 0 failures across the navigation source and changed immersive/navigation components.
- Archive integrity: verified.
- Native Rust compilation remains unavailable in the execution host because Cargo/Rust is not installed; the project Docker builder still supplies Rust/Cargo.
