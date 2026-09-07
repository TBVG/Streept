# Streept Alpha 58 — Spatial Runtime + Navigation UX Pass

- Fixed a high-impact immersive-scene lifecycle leak: generated road, verge, lane and edge primitives are now owned by one tracked `PrimitiveCollection` and removed atomically when the maneuver scene changes.
- Added async scene-generation guards so stale OSM responses cannot paint an older maneuver into the current 3D view after rapid GPS/maneuver changes.
- Reworked maneuver scene cache keys to reuse a geographic corridor across route-session changes instead of duplicating the same OSM context for every route hash.
- Expanded predictive scene prefetch radius to 320 m for smoother handoff on faster approaches.
- Kept route/turn guidance entities separate from reusable static scene primitives so navigation overlays stay crisp while static geometry is recycled.
- No paid map/3D API dependency introduced.
