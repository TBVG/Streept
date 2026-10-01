# Streept Rust-first architecture — completed migration boundary

Streept's renderer-independent navigation decision plane is now owned by Rust.
The browser remains responsible for device integration, low-latency continuity,
and presentation.

## Rust ownership

`backend/src/navigation/`

- `geometry.rs` — route geometry projection and distance primitives.
- `route_decision.rs` — route risk, learned road difficulty, maneuver
  complexity, explainable route scoring, and candidate ordering.
- `runtime.rs` — spatial context, hazard policy, lane-policy signals,
  intersection preparation, spatial guidance, and driver-facing decisions.

HTTP boundaries:

- `POST /api/navigation/analyze` — candidate route analysis and ordering.
- `POST /api/navigation/decision` — live driver-facing decision policy.

## Browser ownership

The browser keeps responsibilities that are inherently device/renderer-facing:

- React UI and interaction.
- Leaflet and Cesium rendering.
- Browser geolocation and motion sensors.
- Low-latency local GPS continuity and continuity fallback.
- Local offline storage and Cache API.
- WebSocket lifecycle.
- Speech and visual presentation.

The existing TypeScript navigation modules remain available where they are
inherently browser/device-facing (GPS continuity, rendering coordination,
voice, simulation and tests). They are not a second route-ranking or live
driver-policy implementation. If Rust intelligence is temporarily
unavailable, the already-computed base route remains usable without invoking
a competing TypeScript scorer.

## Organization rule

New renderer-independent navigation intelligence belongs under
`backend/src/navigation/`. Browser-only navigation code stays under
`frontend/src/navigation/`. The Rust bridge lives under
`frontend/src/navigation/rust/`.

There must be exactly one Rust `navigation` module layout: the directory form
`backend/src/navigation/mod.rs`. A sibling `backend/src/navigation.rs` must not
be reintroduced.
