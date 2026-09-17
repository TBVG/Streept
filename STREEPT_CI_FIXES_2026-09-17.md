# Streept CI fixes — 2026-09-17

This update resolves the frontend and backend CI failures found after the Phase 8 push.

## Frontend

- Hardened lane metadata handling when optional lane indications are absent.
- Made driver and spatial guidance decision layers tolerate older/partial snapshots without crashing.
- Fixed maneuver outcome transitions so a changed maneuver correctly reports a missed/completed prior maneuver.
- Improved lane-change traffic-gap diagnostics while retaining conservative merge-point safety checks.
- Allowed uncertainty to escalate immediately through the guidance stabilizer.
- Strengthened repeated-missed-maneuver road intelligence scoring.
- Increased the weight of strong independent world-context evidence.
- Ensured navigation-critical scene objects outrank generic maneuver cues when scores tie.
- Added a small in-memory `localStorage` shim for Vitest's Node environment.
- Corrected the cloud-sync test fixture so `recordHazard` is exercised with an actual hazard state.

## Backend

- Updated all parking check-in integration-test request literals to include the now-optional `location` field.

## README

- Removed the `$0 deployment goal` section from the product README.

The project remains web-first; this change does not add App Store/native-platform requirements.
