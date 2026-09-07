# Streept Alpha 54 — Integrated Navigation + Spatial Performance Pass

- Added a shared client scene cache with opportunistic prefetch for the next three maneuvers.
- Immersive OSM road surfaces are now batched into a Cesium primitive using corridor geometry, reducing per-road entity overhead.
- Preserved high-priority near-camera lane separators and road-name labels.
- Kept building geometry batched and reused the shared scene cache to avoid duplicate context requests.
- Added tighter route/scene fetch timeouts and bounded scene-cache eviction.
- Kept all core map/routing/scene services keyless for development.
