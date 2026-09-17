# Streept Pass 48 — Multi-Maneuver Lane Planning

Implemented route-wide lane selection using a conservative dynamic-programming planner.

- Evaluates several consecutive lane-aware maneuvers together instead of choosing each lane greedily.
- Penalizes unnecessary lane changes and lateral oscillation/reversal.
- Preserves explicit OSM/OSRM lane recommendations and destination indications.
- Keeps unknown/no-metadata maneuvers as information gaps; it does not invent lanes.
- Produces per-maneuver planned lane, next planned lane, lookahead change count, stability, and confidence.
- Existing physical lane staging and traffic-safety execution remain separate safety gates.

This improves lane continuity before junctions: when the same lane can serve multiple upcoming maneuvers, Streept prefers holding that lane rather than changing away and changing back.
