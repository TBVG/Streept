# Streept Alpha 171 — Route Decision Intelligence

- Added bounded, explainable route-choice scoring.
- Maps candidate routes to known OSM scene ways before applying learned intelligence.
- Combines provider route score, maneuver complexity, community road difficulty, and confidence.
- Community evidence is advisory and cannot invent topology or override route legality.
- NavigationView now attempts community-informed route ordering and falls back to existing risk ranking on failure.
- Added deterministic route decision tests.
