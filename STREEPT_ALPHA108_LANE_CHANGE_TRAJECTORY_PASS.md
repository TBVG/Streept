# Streept Alpha 108 — Physical Lane-Change Trajectory Pass

Alpha 108 connects lane-change execution to geographic lane-centerline geometry.

## Implemented
- Added `laneChangeTrajectory.ts` to build a geographic source-lane → target-lane trajectory from OSM road geometry.
- Uses smoothstep lateral motion instead of linear lane-index interpolation.
- Checks physical runway and rejects changes when the available road geometry is too short.
- Produces trajectory length, lateral shift, confidence and reachability metadata.
- `SceneGuidancePlan` now exposes the physical lane-change trajectory.
- Cesium lane-change rendering prefers the physical trajectory and retains the previous interpolation only as a renderer fallback when physical scene data is unavailable.
- Added regression tests for physical trajectories, insufficient runway and same-lane behavior.

## Validation
- Frontend TS/TSX syntax validation is expected to run with the project's dependency/Docker environment.
- ZIP integrity verified after packaging.
- Full dependency-backed TypeScript and Rust compilation still requires the project's Docker build environment.
