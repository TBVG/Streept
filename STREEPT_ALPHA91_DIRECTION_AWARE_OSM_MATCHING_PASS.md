# Streept Alpha 91 — Direction-Aware OSM Segment Matching

Alpha 91 makes OSM way identity directional rather than purely geometric. Scene-way matching now operates on actual road segments, respects `oneway`/`oneway_reverse`, and uses route/GPS heading to select the travel direction on bidirectional geometry. The result exposes `travelDirection` for downstream restriction and carriageway intelligence.

## Delivered
- Direction-aware segment projection.
- Correct forward/reverse semantics for `oneway` and OSM `oneway=-1`.
- Heading-aware matching for bidirectional ways.
- Continuity bonus retained to reduce noisy parallel-carriageway flips.
- Route-derived way sequences now use adjacent route heading.
- NavigationEngine GPS matching passes its current heading into the scene matcher.
- Regression tests cover reverse one-way traversal and bidirectional heading selection.

## Boundary
This pass intentionally does not infer lane-level direction from `turn:lanes`; that belongs to the later lane-graph work. Unknown heading remains conservative.
