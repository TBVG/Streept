# Streept Alpha 68 — Lane Graph Intelligence Pass

- Added a legal local lane graph for maneuver approaches.
- Added shortest-path analysis across legal adjacent lane changes.
- Corrected `only:left` / `only:right` restriction handling.
- Added reachability and confidence analysis.
- Added regression coverage for restricted and multi-lane transitions.

Remaining: full intersection connectivity from server-side OSM extracts, successive-maneuver lane connectivity, and real-world validation.
