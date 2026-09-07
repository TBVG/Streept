# Streept Alpha 80 — Deep Lane Topology + Route-Wide Lane Planning

## What changed

Alpha 80 moves lane guidance from isolated maneuver metadata toward a route-wide topology model.

### Backend
- `SceneRoad` now preserves `osm_id` and ordered `node_ids`.
- Runtime scene extraction carries the OSM way/node identities through to the browser.
- Existing scene-tile JSON remains backward compatible because the new fields default when absent.

### Navigation core
- Added `physicalLaneTopology.ts`.
- Shared OSM node IDs are used as explicit junction anchors.
- Incoming/outgoing road lanes are converted into physical connector geometry.
- Connector confidence records how strongly the geometry is grounded in source topology.
- Added `buildRouteLanePlan()` to carry lane intent across the full maneuver sequence.
- The plan tracks target lane, required changes, reachability, direction and confidence per maneuver.

### 3D scene
- Cesium now renders topology-grounded junction connectors when OSM node topology is available.
- Existing inferred lane ribbons remain available as a fallback when physical topology is missing.

## Validation

- All frontend TypeScript/TSX sources passed `typescript.transpileModule` syntax validation.
- Example scene-tile JSON parses successfully.
- Full dependency build was not claimed because the archive does not contain `node_modules` and the current environment lacks Cargo.
