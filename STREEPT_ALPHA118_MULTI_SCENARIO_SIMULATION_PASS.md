# Streept Alpha 118 — Multi-Scenario Navigation Simulation

Alpha 118 turns the deterministic drive simulator into a compact regression suite for the full navigation decision stack.

## Covered scenarios

- clean GPS drive
- degraded GPS with deterministic position/lateral noise
- extended GPS dropout using continuity/dead reckoning
- fresh target-lane occupant blocking a physical lane-change trajectory
- community `closed_lane` report blocking a lane change
- three-to-two lane complex-junction merge with a second maneuver close behind it

## Integration exercised

The scenarios reuse the production `NavigationEngine`, GPS plausibility checks, route matching, sensor fusion, continuity, physical lane-change trajectory, vehicle dynamics, traffic safety, unified maneuver decisions, and complex-junction lane resolution.

The suite is deterministic and renderer-independent. It does not invent live traffic: traffic blockers exist only in explicit scenario fixtures.

## Validation contract

A scenario fails when the simulated drive does not complete, route progress regresses, required continuity is not exercised, an unsafe lane change becomes `change-now`, or a legal complex merge loses physical continuity.

## Remaining work

The next step is richer scenario choreography: actually advance lane-change execution over simulated time, inject reroute events, model dynamic traffic gaps, and expose a replay timeline for debugging the 3D driver view.
