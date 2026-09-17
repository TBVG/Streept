# Streept Spatial Lane Intelligence — Pass 30

Pass 30 connects the existing OSM lane semantics and physical lane matcher into the canonical spatial intelligence snapshot.

## Added
- `spatialLaneIntelligence.ts`
- Current lane vs route-compatible lanes
- Alignment state: aligned / misaligned / unknown
- Lane-change direction and required lane changes
- Conservative confidence when OSM lane semantics are incomplete
- NavigationEngine now supplies its current physical lane to spatial intelligence
- Regression tests for aligned, misaligned, and unknown lane semantics

This is a renderer-independent layer: it describes what the route requires without commanding a driver to make an unsafe maneuver.
