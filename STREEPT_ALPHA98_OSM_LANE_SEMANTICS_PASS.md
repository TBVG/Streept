# Streept Alpha 98 — OSM Lane Semantics

The immersive navigation lane graph now consumes `turn:lanes`, `change:lanes`, and `destination:lanes` metadata from the OSM scene extract.

## Behavior
- `turn:lanes` is parsed into per-lane turn capabilities and used to prefer lanes matching the upcoming maneuver.
- `change:lanes` is used as a legality guard before a physical connector is rendered.
- `destination:lanes` is retained with lane semantics for future destination-aware route scoring.
- Explicit OSRM recommended lanes still take precedence when supplied.
- When OSM lane semantics are absent, the previous proportional lane mapping remains the fallback.

## Scope
This pass improves lane choice and physical connector selection. It does not claim perfect OSM lane-tag coverage: tagging conventions vary, and destination matching can be expanded in a later pass.
