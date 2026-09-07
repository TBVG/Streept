# Streept Alpha 110 — Physical Lane-Change Execution Pass

## Goal
Connect the physical lane-change trajectory to the live execution state machine so a requested lane change is no longer assumed reachable.

## Changes
- Added `laneChangeReachability.ts` as the physical feasibility gate.
- Reachability now considers the generated physical lane-change trajectory length, live distance to the maneuver, lane-match confidence, and a safety buffer.
- `NavigationView` now builds the same renderer-independent scene guidance plan used by the immersive view and feeds its physical trajectory into lane-change execution.
- The execution tracker records reachability confidence and the meter position at which an active change began.
- Low-confidence physical feasibility produces an `uncertain` execution state rather than blindly instructing a maneuver.
- A physically unreachable change is marked `missed` with reason `unreachable`, allowing the existing reroute path to take over.

## Result
The 2D navigation execution state and the Cesium physical trajectory now share one feasibility decision. This removes the previous `reachable: true` shortcut from the live lane-change path.

## Remaining limitation
The trajectory is still generated from local OSM scene geometry and is not yet fused with vehicle dynamics (speed, acceleration, steering limits, or adjacent-vehicle occupancy). Those belong in a later safety/dynamics pass.
