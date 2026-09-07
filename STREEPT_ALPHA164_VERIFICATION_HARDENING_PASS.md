# Streept Alpha 164 — Verification Hardening Pass 13

This pass addresses the remaining Pass 12 verification failures.

## Backend
- Added `Clone` to `RouteCoord`, completing the `Route3DHighlight -> RouteSegment -> RouteCoord` clone chain required by Rust derives.

## Frontend
- Corrected current-lane matcher fixtures to place the GPS fix at the physical center of the leftmost lane rather than near the road centerline. The matcher itself retains directional lateral canonicalization for reverse one-way roads.
- Corrected the `only:right` lane-graph fixture so it actually tests a forbidden leftward move from a lane whose marking permits only rightward changes.
- Hardened the urgent maneuver decision branch so a reachable, explicitly urgent lane change remains `change-now` when confidence is above the safety floor.

## Validation
- Typechecked the affected navigation TypeScript modules successfully with TypeScript 5.8.3.
- Full Vitest and Docker verification must be rerun on the user's Windows environment; the assistant environment does not have the project's Rust/Docker toolchain available.
