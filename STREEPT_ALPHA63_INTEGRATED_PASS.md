# Streept Alpha 63 — Integrated Spatial + Lane Intelligence

## Navigation intelligence
- Driver-aware lane estimate from signed route-relative position.
- Lane topology model exposes allowed lane changes and target movement guidance.
- Guidance UI can distinguish staying in lane from moving toward the target lane.
- OSM lane-specific turn/change/destination metadata retained in scene-road contracts.

## Spatial engine
- Immersive scene lane markings are batched into Cesium primitives.
- Street-level building detail is distance-bounded around the upcoming maneuver.
- OSM turn-lane arrows are surfaced near the decision point in immersive mode.
- Scene requests remain local to the maneuver, while cached context is reused.

## Reliability / QA
- Added a deterministic navigation regression scenario matrix covering urban turns, forks, roundabouts, GPS dropout, and offline trips.
- Existing stale-response and route lifecycle protections remain intact.
