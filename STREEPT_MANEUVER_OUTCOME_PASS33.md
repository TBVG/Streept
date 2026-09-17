# Streept Pass 33 — Maneuver Outcome Intelligence

Added a renderer-independent maneuver outcome tracker.

It observes route-order maneuver distance and lane alignment, requires a real approach window before declaring completion, and distinguishes completed vs missed maneuvers when the active maneuver changes. Route generation changes reset the tracker so stale outcomes cannot leak across reroutes.

The navigation engine exposes the current `maneuverOutcome` in its canonical snapshot. The telemetry vocabulary now supports `maneuver_completed` and `maneuver_missed` for the next data-flywheel integration.

No paid services or dependencies were added.
