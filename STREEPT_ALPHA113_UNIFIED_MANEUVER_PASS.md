# Streept Alpha 113 — Unified Maneuver Decision Engine

## Goal
Combine lane-change timing, physical reachability, GPS confidence, vehicle dynamics, and traffic safety into one deterministic maneuver policy.

## Implemented
- Added `navigation/maneuverDecision.ts` as the single policy layer.
- Preserves domain-specific calculations in their existing modules.
- Produces driver-facing actions: `hold`, `prepare`, `change-now`, `uncertain`, or `reroute`.
- Propagates recommended speed and safety reason into lane-change execution.
- Keeps unsafe-but-recoverable conditions in `uncertain` instead of commanding a maneuver.
- Converts genuinely too-late/unrecoverable decisions into the existing reroute path.
- Added regression tests for preparation, immediate execution, unsafe traffic recovery, and too-late reroute decisions.

## Safety boundary
This is navigation policy, not an autonomous-driving controller. It does not command steering, braking, or acceleration and does not claim certified vehicle safety.
