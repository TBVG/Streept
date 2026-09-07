# STREEPT Alpha 152 — Cross-Bubble Physical Object Identity

## Completed
- Added renderer-neutral stable scene object identities.
- Prefer OSM way/object IDs and node IDs; use deterministic quantized geometry as fallback.
- De-duplicate buildings, roads, signals, crossings, stops, trees, lamps and restrictions before chunk ownership.
- Keep absolute spatial chunk keys so overlapping scene bubbles resolve to the same physical chunk.
- Added deterministic tests for OSM identity, geometry identity and duplicate extraction removal.

## Why this matters
Alpha 151 bounded scene residency, but overlapping scene extracts could still describe the same physical object more than once. Alpha 152 makes physical-object identity deterministic before Cesium rendering, reducing duplicate geometry and avoiding visual seams during bubble handoff.
