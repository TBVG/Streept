# Streept Alpha 120 — Route-Wide Navigation Replay

## What changed
- Added `navigation/routeNavigationReplay.ts` as a deterministic route-wide replay harness.
- Replays multiple successive lane changes in one navigation session.
- Marks maneuvers that represent synthetic junction boundaries and verifies the replay crosses them without resetting navigation.
- Supports dynamic target-lane vehicle blockers and recovery after a blocker clears.
- Supports missed maneuvers triggering a guarded reroute and optional replacement route.
- Keeps GPS dropout/continuity in the same timeline while lane confidence is reduced.

## Regression scenarios
1. Successive lane changes with a junction transition.
2. Temporary blocker with uncertain execution followed by recovery.
3. Persistent blocker causing a missed maneuver and replacement-route reroute.
4. GPS dropout during route-wide execution with continuity.

## Validation
- Deterministic unit coverage added for all four route-wide behaviors.
- TypeScript syntax/transpile validation should include the new replay module and test.
- Full dependency-backed Vitest/build remains environment-dependent when `node_modules` is absent.
- Rust compilation remains Docker-dependent in this environment.

## Next
- Replace synthetic maneuver distances with actual route maneuver geometry and richer multi-vehicle tracks.
