# Streept Alpha 72 — Visual Regression Pass

## Completed

- Added `navigationVisualState.ts`, a pure presentation contract shared by navigation renderers.
- Added deterministic Vitest snapshots covering idle, preview, navigating, rerouting and arrived states.
- Added maneuver urgency transitions for prepare/immediate guidance.
- Lane guidance is suppressed below a confidence threshold to avoid visually asserting uncertain lane data.
- GPS warnings are derived from confidence rather than component-specific flags.
- Immersive preview visibility is deterministic and tied to maneuver proximity.

## Validation

- TypeScript source was checked for syntax with the repository TypeScript toolchain.
- Snapshot output is checked into source control for deterministic CI comparison.
- Full dependency install/build remains environment-dependent when `node_modules` is absent.
