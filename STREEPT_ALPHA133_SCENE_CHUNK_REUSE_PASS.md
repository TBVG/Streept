# STREEPT Alpha 133 — Chunk-Level 3D Scene Reuse

Implemented spatial chunking for the immersive OSM scene so renderer work can be retained at stable geographic boundaries instead of treating every scene bubble as one monolithic render unit.

## Completed
- Added framework-neutral spatial scene chunking with stable 180 m grid keys.
- Scene roads/buildings/points are grouped into deterministic chunks.
- Chunk boundaries are independent of response ordering.
- Prepared the renderer lifecycle for per-chunk primitive reuse.
- Kept navigation route geometry, driver marker, and live traffic separate from chunk lifecycle.
- Added regression coverage for spatial grouping and empty-scene behavior.

## Design intent
A moving driver normally crosses one chunk boundary at a time. This makes it possible to retain unchanged nearby scene work while adding/removing only the chunk entering or leaving the active bubble.

## Remaining refinement
The current renderer still performs the final Cesium primitive construction for a newly requested chunk. Future work can add renderer-side object pooling and background preparation without changing the chunk contract.
