# Streept Alpha 99 — Destination-Aware Lane Intelligence

Alpha 99 makes OSM `destination:lanes` useful to the live navigation experience.

## Implemented
- Normalized fuzzy destination matching across lane destination strings.
- Destination lane ranking combines destination match and maneuver turn semantics.
- Immersive Cesium guidance now prefers the nearest OSM road carrying matching destination-lane metadata.
- Physical lane connectors use the destination-selected lane when available, while retaining OSRM/recommended-lane fallback.
- Added meter-based lane-change timing with prepare/change-now/too-late states.
- `buildLaneRoutePlan` accepts an optional destination label so the route planner can make the same decision as the 3D renderer.
- Added focused unit tests for destination matching and timing.

## Safety / fallback
No destination tag is treated as permission to invent a destination. If OSM destination metadata is absent or does not match, existing OSRM lane recommendations and proportional physical-lane mapping remain the fallback.

## Next
Alpha 100 should connect destination-aware timing to the driver lane estimate and produce continuous spoken/visual prompts such as “move right in 120 m” while suppressing lane-change advice when the current lane is already compliant.
