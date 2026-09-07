# Streept Alpha 111 — Vehicle Dynamics + Lane-Change Safety

## Goal
Move lane-change feasibility from purely geometric runway checks toward a conservative vehicle-aware execution model.

## Changes
- Added `laneChangeDynamics.ts` with a renderer-independent lane-change dynamics heuristic.
- Estimates lane-change time from trajectory length and current speed.
- Models the smoothstep lateral transition using maximum lateral acceleration and lateral-rate limits.
- Derives a recommended lane-change speed from the physical trajectory and conservative comfort limits.
- Adds reaction distance and braking distance before the physical lane-change runway.
- Integrates the dynamics result into the existing physical reachability gate.
- Live execution now receives dynamics confidence, recommended speed, and safety reason.
- Dynamic risk becomes `uncertain` while there is still time to recover; an already-too-late dynamic failure can enter the existing missed/reroute path.

## Result
A lane change is no longer considered executable simply because its geometry fits. At higher speeds, Streept can require additional runway to react and slow down before entering the lateral transition.

## Important limitation
This is a navigation safety heuristic, not a certified automotive control model. It does not yet model tire friction, vehicle mass, steering actuator limits, road surface, curvature coupling, or surrounding traffic occupancy.
