# Streept Alpha 140 — Route-Ahead Visual Continuity

Alpha 140 extends the driver-first road focus beyond the active junction without turning the full route into a glowing ribbon.

## What changed
- Added a renderer-neutral `RouteAheadContinuityPlan` that identifies the next maneuver and creates a bounded bridge from the driver's current position/current junction toward the next decision.
- The bridge stops before the next maneuver so that the next junction's stronger approach/decision/exit cues can take over cleanly.
- Added a subtle physical lane surface for that bridge, using the existing lane geometry language rather than introducing another UI layer.
- The bridge is intentionally low-emphasis and becomes stronger only when the next maneuver is complex.
- Added deterministic tests for consecutive maneuvers, driver-position starts, and final-maneuver behavior.

## Design principle
The route should read as a continuous physical road, but only the portion that helps the driver make the next decision should receive visual emphasis. Junction cues remain dominant; the route-ahead bridge simply prevents the guidance from visually disappearing between decisions.
