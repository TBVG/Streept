# Streept Pass 47 — Predictive Lane Planning

Pass 47 adds a route-aware lane-step scheduler on top of the existing lane geometry, dynamics, traffic safety, and adjacent-lane staging layers.

## What changed

- Keeps the final maneuver lane as destination intent while scheduling one adjacent physical lane step at a time.
- Re-evaluates the next step from the vehicle's newly matched lane after each completed adjacent transition.
- If traffic currently blocks the next step but sufficient runway remains, the planner waits instead of immediately declaring the maneuver lost.
- If the blocked step is inside its remaining safe runway, the planner escalates toward rerouting.
- Lane execution now exposes a driver-facing `Waiting for a safe gap before changing lanes` state rather than treating a temporary traffic block as an immediate failure.
- Existing hard safety gates remain authoritative: the planner never permits a lane change when the underlying reachability/traffic layer says it is unsafe.

## Design principle

The planner is intentionally conservative. It does not invent lanes, vehicles, gaps, or route topology. It schedules only decisions supported by the existing scene, route, lane, dynamics, and traffic observations.
