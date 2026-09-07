# Streept Alpha 84 — Junction Geometry & Complex Maneuvers

This pass connects legal lane routing to physically continuous 3D lane geometry. Junction connectors now use tangent-based cubic curves rather than a single midpoint, preserve altitude, classify complex maneuvers, and rank connected outgoing OSM ways against the maneuver bearing. Roundabouts, merges, splits, ramps and U-turns carry explicit geometry kinds and confidence.

Validation: frontend TypeScript transpilation passed for all source files in this workspace. Full dependency build is not claimed because node_modules is not bundled.
