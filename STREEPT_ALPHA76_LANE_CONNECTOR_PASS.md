# Streept Alpha 76 — Lane Connector Topology Pass

## Goal
Replace the immersive renderer's ad-hoc diagonal lane-change line with an explicit, testable lane connector topology produced by the navigation layer.

## Changes
- Added `frontend/src/navigation/laneConnectorTopology.ts`.
- Added explicit `LaneConnector` / `LaneConnectorTopology` contracts with source/confidence metadata.
- Connector legality and target selection reuse OSRM lane validity/recommendation metadata.
- Connector geometry is generated as a short three-point lane-center path and is explicitly marked `inferred-lane-geometry` because OSRM's maneuver lane metadata does not provide physical connector centerlines.
- `SceneGuidancePlan` now carries the connector topology into the renderer.
- `ImmersiveTurnView` renders the topology rather than constructing a one-off diagonal connector.
- Added deterministic tests for trusted-lane changes and unknown-lane degradation.

## Result
Lane-level 3D guidance now has a renderer-independent connector topology with confidence/source semantics. This is the correct abstraction boundary for later ingestion of true OSM lane-to-lane connector geometry without changing the Cesium renderer API.

## Validation
- TypeScript changed modules syntax/transpile-checked with the installed compiler.
- ZIP integrity checked with `unzip -t`.
- Full dependency installation/build was not run because the archive contains no `node_modules` and dependency installation is network/time constrained.
- Rust compilation remains unavailable because `cargo` is not installed in this environment.
