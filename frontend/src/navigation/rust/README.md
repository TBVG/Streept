# Rust navigation bridge

This folder is the only browser-facing bridge for Rust-owned navigation policy.

- `navigationEngineApi.ts` — typed HTTP contracts for route analysis and live navigation decisions.

## Architecture invariants

- Rust is the authoritative implementation for navigation policy, route intelligence, spatial decisions, hazards, lane policy, maneuver policy and driver-facing decisions.
- The browser owns device APIs, rendering, animation and UI state.
- Route display is **cache-first**: a locally stored route is committed before live routing is awaited.
- Live routing, Rust scoring, community intelligence and tile warming are background work and must not block the first usable route.
- The old TypeScript route-ranking fallback is intentionally not used; if Rust intelligence is unavailable, the base route remains usable rather than running a second competing navigation brain.
- A network failure never replaces a usable cached route with a loading/error screen.

The long-term performance target is an instant-first navigation runtime: persistent state, local cache hits, asynchronous enrichment and no unnecessary blocking work on the user interaction path.

- `navigationSession.ts` — persistent Rust runtime session; route topology is installed once, world context is refreshed separately, and live GPS observations stay small.
- Navigation sessions are per-session locked on the backend so independent users do not serialize each other's decision work.
