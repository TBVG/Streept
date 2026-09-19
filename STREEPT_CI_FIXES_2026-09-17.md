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

## E2E API isolation fix — 2026-09-19

GitHub Playwright was starting the frontend without a reachable backend, so browser API requests were falling through to the Vite proxy and producing `ECONNREFUSED`. The E2E suite now starts a deterministic local mock API on `127.0.0.1:3001` and launches the production preview with `VITE_API_URL` / `VITE_WS_URL` pointed at that mock service. The existing browser-level API interception remains in place, so the tests do not depend on external geocoding, OSRM, PostgreSQL, or a live Rust backend.
