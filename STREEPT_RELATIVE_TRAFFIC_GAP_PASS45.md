# Streept Pass 45 — Relative Traffic Gap Prediction

## What changed

Streept's lane-change traffic gate now uses relative motion when reliable vehicle telemetry is available, rather than treating every nearby target-lane vehicle as a static obstacle.

### Added
- Ego speed and heading are passed into lane-change reachability.
- Target-lane occupants can provide speed and heading.
- Vehicle motion is projected onto the physical lane-change trajectory.
- Faster vehicles closing from behind can now block a lane change even when their current distance is larger than the static safety threshold.
- Vehicles ahead that are moving away faster than the driver are not incorrectly treated as closing conflicts.
- Strongly opposing heading observations are treated as immediate conflicts while inside the caution zone.
- Time-to-conflict is exposed as `timeToConflictSeconds` for downstream decisioning/telemetry.

## Safety model

The model remains conservative:

1. stale or low-confidence observations are ignored;
2. static longitudinal gap remains a hard baseline;
3. relative-motion prediction is only applied when speed and heading data are available;
4. predicted conflicts inside 3.5 seconds block the lane change;
5. closed-lane reports remain a hard block.

This is still a geometric/telemetry prediction, not autonomous-driving-grade vehicle prediction. It intentionally fails conservatively when required information is missing.
