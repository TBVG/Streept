# Streept Alpha 119 — Time-Stepped Maneuver Replay

## What changed
- Added `navigation/maneuverReplay.ts` as a deterministic, renderer-independent lane-change replay harness.
- Replays the production lane-change execution state machine frame by frame instead of evaluating a maneuver only once.
- Exercises physical trajectory, vehicle dynamics, traffic safety, destination timing, unified maneuver decisions, and `NavigationEngine.updateLaneChangeExecution()` together.
- Supports changing target-lane blockers, GPS dropout/continuity, and guarded rerouting after a missed maneuver.

## Scenarios covered
1. Normal `prepare -> changing -> completed` lane change.
2. Target-lane blocker causing `uncertain`, then recovery after the blocker clears.
3. Persistent blocker causing a too-late/missed maneuver and a guarded reroute.
4. GPS dropout during maneuver with continuity while lane confidence is reduced.

## Validation
- Added deterministic replay tests for all four cases.
- TypeScript syntax/transpile validation should include the new replay module and test.
- Full dependency-backed Vitest/build remains environment-dependent when `node_modules` is absent.
- Rust compilation remains Docker-dependent in this environment.

## Next
- Extend replay into route-wide maneuver sequences: successive lane changes, junction transitions, reroute replacement routes, and multi-vehicle interactions.
