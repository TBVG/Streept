# Streept Alpha 116 — Complex Intersection Lane Resolution

Alpha 116 hardens route-wide lane planning for real intersections where a simple lane index is not a reliable physical identity.

## Implemented
- Detects lane-count changes, merges, splits and ramp/slip-lane transitions.
- Uses the existing physical junction connector/mapping model to resolve source-to-target lane continuity.
- Keeps semantic `turn:lanes` guidance when it agrees with physical topology.
- Reduces confidence instead of silently accepting a conflicting lane target.
- Treats maneuvers within roughly 80 m as a coupled/close-maneuver case.
- Refuses continuity when OSM directionality or turn restrictions make the transition illegal.

## Validation
- Added regression coverage for merge, ramp/slip-lane, close-maneuver and illegal-direction cases.
- Full dependency-backed TypeScript typechecking still requires the frontend dependencies; host Rust compilation remains unavailable outside the backend Docker build.
