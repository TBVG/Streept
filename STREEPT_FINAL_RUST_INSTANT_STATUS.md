# Streept — Final Rust + Instant Architecture Status

## Runtime architecture

- Rust is the authoritative navigation-policy implementation.
- Navigation sessions are persistent and stateful for the active trip.
- Route topology and scene context are installed once and refreshed independently.
- Live GPS observations use the small session step contract rather than resending route topology.
- Independent navigation sessions use independent async locks, so one driver's decision work does not serialize other sessions.
- Inactive sessions are automatically purged after 30 minutes.

## Instant-first behavior

- Local IndexedDB route cache is consulted before live routing.
- A cached route is committed without waiting for the network.
- Fresh routing, Rust route ranking, community intelligence, and tile warming are background work.
- No route-loading overlay/state blocks the navigation UI.
- Rust decision failures leave the usable base route and last valid driver state intact.
- Stale/slow Rust responses are cancelled or ignored using latest-request semantics.

## Browser responsibilities

React/TypeScript remains responsible for browser APIs, GPS acquisition, map/3D rendering, animation, accessibility, and presentation. Computational navigation policy belongs to Rust.

## Validation

Dependency-independent navigation TypeScript check: PASS.

Structural release checks: PASS.

JSON/package checks: PASS.

Python and shell syntax checks: PASS.

Rust compilation: not performed in this coding environment because `cargo`/`rustc` are unavailable. The supplied Docker build is the required compiler-level validation.

Frontend full dependency build: not performed here because the environment could not download the npm dependency graph. The Dockerfile uses `npm install` from the frontend manifest.
