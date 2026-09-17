# Streept Pass 27 — Spatial Guidance Stability

## What changed

Streept's spatial guidance decision is now stabilized before it reaches the navigation snapshot.

- Higher-priority guidance escalates immediately.
- Lower-priority guidance is held briefly (900 ms by default) to prevent flicker around GPS/scene thresholds.
- Uncertainty still escalates immediately so the system does not overstate confidence.
- The stabilizer resets on route replacement and scene-context replacement.
- Added focused Vitest coverage for escalation, downgrade hold, and uncertainty escalation.

## Why

GPS positions and map evidence can move slightly from one update to the next. Without stabilization, a driver-facing cue can rapidly alternate between states such as `high-alert` and `prepare`. This pass makes the experience calmer without delaying safety-relevant escalation.

## Cost constraint

No paid APIs, cloud services, or external dependencies were added.
