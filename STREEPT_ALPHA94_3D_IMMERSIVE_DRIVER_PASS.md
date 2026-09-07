# Streept Alpha 94 — Immersive Cesium Driver View

This pass makes the Cesium scene explicitly driver-perspective rather than treating it as a generic 3D map.

- Driver-height camera sits behind the live GPS position and looks ahead along the travel bearing.
- Look-ahead distance adapts to the current maneuver preview window.
- A lightweight generated vehicle marker follows the smoothed navigation position and rotates with travel heading.
- Vehicle state is recreated safely when the scene corridor is refreshed so `entities.removeAll()` cannot leave a stale reference.
- Existing OSM roads, buildings, lane markings, physical lane connectors, route highlighting and turn guidance remain the scene's world geometry.

The next pass can connect the physical lane graph more directly to the rendered lane ribbons/connectors and then harden camera transitions around complex junctions.
