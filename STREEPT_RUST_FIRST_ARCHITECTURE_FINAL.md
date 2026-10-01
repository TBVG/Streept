# Streept Rust-first architecture — final migration pass

This pass makes Rust the owner of the navigation **decision plane**, rather
than only a route-scoring helper.

## Rust owns

`backend/src/navigation/`

- `geometry.rs` — route geometry projection and distance primitives.
- `route_decision.rs` — route risk, learned road difficulty, maneuver
  complexity, explainable route scoring, and candidate ordering.
- `runtime.rs` — spatial context, hazard policy, lane-policy signals,
  intersection preparation, spatial guidance, and driver-facing decisions.

The HTTP boundary is intentionally small:

- `POST /api/navigation/analyze` — route choice.
- `POST /api/navigation/decision` — live driver-facing decision policy.

## Browser owns

The browser remains responsible for things that are inherently device or
renderer-facing:

- React UI and interaction.
- Leaflet and Cesium rendering.
- Browser geolocation and motion sensors.
- Low-latency local GPS continuity/map matching.
- Local offline storage and Cache API.
- WebSocket lifecycle.
- Speech and visual presentation.

Those responsibilities are not moved into Rust merely to increase a line-count
percentage. Moving them would add latency and make the browser less resilient.

## Decision flow

```text
GPS / sensors / route / scene / reports / traffic
                    |
                    v
        browser continuity + evidence
                    |
                    v
       POST /navigation/decision
                    |
                    v
              Rust engine
        +-----------------------+
        | spatial context       |
        | hazard policy         |
        | lane policy           |
        | junction policy       |
        | guidance              |
        | driver decision       |
        +-----------------------+
                    |
                    v
             React presentation
```

The existing TypeScript decision modules remain as a local continuity fallback
for temporary API failures and for browser-only simulation/unit-test paths.
They are no longer the normal source of the route-selection or driver-facing
policy used by the product UI.

## Organization rule

New navigation intelligence belongs under `backend/src/navigation/` when it is
renderer-independent. Browser-only navigation code stays under
`frontend/src/navigation/`. The Rust bridge lives under
`frontend/src/navigation/rust/` so the API boundary is explicit and easy to
find.
