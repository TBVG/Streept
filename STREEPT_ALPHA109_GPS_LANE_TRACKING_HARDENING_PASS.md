# Streept Alpha 109 — GPS + Lane-Level Tracking Hardening

Alpha 109 makes lane state temporal rather than trusting every GPS fix.

## Added
- `laneTrackingStability.ts` with lane observation hysteresis and re-acquisition.
- GPS accuracy, physical match distance, heading error, and low-speed uncertainty now reduce lane confidence.
- A single noisy lane observation cannot immediately flip the active lane.
- Repeated strong observations are required before accepting a lane change; way transitions require repeated evidence too.
- Weak or inaccurate fixes hold the last stable lane instead of creating a false lane change.
- `CurrentLaneMatch` now exposes physical distance and heading error separately from its scoring distance.
- NavigationEngine resets lane stability on route replacement and scene-context replacement.

## Tests
- One-fix lane flip rejection.
- Repeated high-confidence lane change acceptance.
- Poor-GPS previous-lane hold.
- Way-transition re-acquisition hysteresis.

This pass is intentionally conservative: lane state may lag a true physical lane change by a few fixes, but it should no longer oscillate because of ordinary GPS noise.
