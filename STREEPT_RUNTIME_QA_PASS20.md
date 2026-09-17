# Streept Runtime QA Pass 20

## Scope

Automated/runtime validation was performed for everything available in the isolated build environment, excluding physical GPS movement as requested.

## Browser/UI validation

A real Chromium 144 browser was available through Playwright. A CSS smoke test loaded the actual Streept navigation styles and verified:

- The desktop trip-preview `Enter navigation` button stays completely inside its card.
- Search results have a higher stacking context than the home command center.
- Search container/results layering is preserved.

Result: **PASS**.

## Routing integrity hardening

Pass 20 adds an explicit provider contract to route geometry:

- Backend OSRM routes are tagged `provider: "osrm"`.
- Browser OSRM fallback routes are tagged `provider: "osrm"`.
- Cached/persisted routes without this provider tag are rejected.
- IndexedDB route storage was moved to `streept_navigation_v2`, invalidating the previous route store.
- Active navigation restoration rejects legacy/synthetic route objects.
- NavigationView refuses to render a route unless it passes the trusted-route validator.
- Added deterministic route-integrity tests for trusted, legacy, malformed, and polyline cases.

This closes an important class of failures where an old synthetic route could remain visible even after the backend stopped generating synthetic routes.

## Environment limitation

The isolated execution environment has Chromium and Playwright, but it does not expose the user's Docker daemon/localhost application and cannot resolve external package registries. Therefore a full live React/browser flow against `http://localhost:3000` could not be executed here. This is an environment limitation, not a claim that the application passed that live test.

Docker, Cargo, and frontend dependencies were therefore not falsely reported as executed in this pass.
