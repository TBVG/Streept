# Streept — Final Release-Candidate Status

## Product spine

Streept now has a single navigation intelligence path from route planning through live driving and immersive presentation:

1. Search / destination planning
2. Trusted OSRM route generation and validation
3. Multi-route decision ranking
4. OSM lane and junction reasoning
5. Local driver execution observations
6. Privacy-conscious community road intelligence
7. Temporal / predictive spatial memory
8. Route-wide intelligence graph
9. Driver guidance confidence and fallback
10. Cesium immersive scene composition
11. Traffic / hazard / parking / billboard world context
12. Offline route persistence and recovery

## Differentiation

The important product asset is not the basemap. It is the learned spatial context attached to the road network: execution difficulty, lane alignment, maneuver outcomes, hazards, junction complexity, and temporal patterns. Every layer is designed to remain useful with sparse data and degrade safely when intelligence is unavailable.

## Zero-cost architecture

- OpenStreetMap geographic data
- Free/public routing and geocoding endpoints during prototype stage
- Postgres/PostGIS
- Rust/Axum backend
- React/Vite frontend
- Leaflet 2D map
- CesiumJS runtime for immersive 3D
- Browser IndexedDB for offline route/scene cache

No paid API key is required by the application architecture.

## Release constraints

The final application still needs to be verified in the user's normal Windows/Docker environment with its installed Node/Rust dependencies. The current coding environment does not have the project's Rust toolchain or installed frontend dependencies, so a full production build is not claimed here. The release package includes a structural Rust gate that runs before dependency installation.

## Next after release candidate

These are expansion tracks, not prerequisites for the current product spine:

- self-hosted OSM/routing infrastructure for scale
- richer real-world traffic providers
- full offline map tiles and offline routing
- larger-scale 3D building/terrain data pipeline
- privacy-preserving fleet learning
- on-device ML for richer prediction
- native iOS/Android driver experience
- automotive integrations


## Current Rust-first release gate

- The old duplicate `backend/src/navigation.rs` module has been removed.
- The canonical Rust navigation module is `backend/src/navigation/mod.rs`.
- Rust navigation analysis, decision, persistent-session, and session-context HTTP endpoints are registered.
- The frontend Rust bridge is present under `frontend/src/navigation/rust/`.
- Live Rust sessions use per-session locks so independent sessions can make decisions concurrently.
- Scene/world context refreshes no longer require restarting the navigation session.
- The route-loading state is not a blocking UI gate; cached routes are committed before live routing returns.
- `scripts/verify-rust-structure.ps1` checks the module layout before dependency installation.
