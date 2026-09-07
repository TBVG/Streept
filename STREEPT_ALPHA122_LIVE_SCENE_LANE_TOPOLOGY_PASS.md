# Alpha 122 — Live Scene Lane Topology Replay

## Scope

This pass moves route replay from replay-only road geometry toward the application's real `SceneContext` and OSM lane topology.

## Implemented

- `RouteReplayConfig.scene` accepts the live scene context already used by immersive navigation.
- Replay matches maneuver/vehicle positions to nearby `SceneRoad` geometry and prefers the matched road for lane-change trajectories.
- Junction replay attempts to recover the actual incoming/outgoing OSM ways from the route and scene before falling back to deterministic synthetic roads.
- Real shared-node topology is passed through `buildPhysicalLaneTopology`, including OSM lane semantics and restrictions, before complex-junction resolution.
- The synthetic fallback remains intact so deterministic replay tests do not require a populated scene extract.
- Added a live-scene junction regression test using two OSM ways sharing a node with a 3-to-2 lane transition.

## Validation

- TypeScript/TSX transpile validation: 83 navigation files, 0 diagnostics.
- ZIP integrity checked after packaging.
- Full dependency-backed Vitest/Vite build was not run because this workspace does not contain `node_modules`.
- Rust compilation remains Docker-dependent because the host validation environment has no Cargo/Rust toolchain.

## Remaining direction

Persistent traffic is still route-polyline based. The next pass should give each simulated vehicle a matched OSM way/segment identity, carry that identity through lane splits/merges and junction connectors, and expose the resulting traffic state directly to the immersive 3D guidance layer.
