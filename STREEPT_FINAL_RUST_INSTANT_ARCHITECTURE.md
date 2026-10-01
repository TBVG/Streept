# Streept Final Rust + Instant Architecture

This release consolidates the navigation architecture around a persistent Rust decision runtime and a non-blocking browser presentation layer.

## Ownership

### Rust
- route decision/ranking
- route risk and learned difficulty
- geometry/projection used by navigation decisions
- maneuver proximity/context
- lane policy
- hazard policy
- junction preparation
- spatial guidance
- driver-facing decision policy
- persistent navigation session state

### Browser/TypeScript
- React UI and presentation
- Leaflet/Cesium/WebGL rendering
- browser GPS/device APIs
- audio output
- local storage/cache adapters
- user interaction and accessibility

## Instant-first rules

1. Cached route data is usable before network refresh.
2. Network route refresh never blocks an already usable route.
3. Rust intelligence never blocks route presentation.
4. Rust navigation sessions receive route topology once and live observations thereafter.
5. Slow Rust responses are latest-wins and abortable.
6. UI does not display a full-page route-loading overlay.
7. Optional traffic/community/scene enrichment is background work.
8. External network latency is not treated as UI latency.

## Performance contract

The application should be benchmarked locally before claiming final performance. The intended targets are:

- cached route presentation: effectively immediate from the UI's perspective
- local navigation state update: target <16 ms where possible
- Rust decision computation: target single-digit milliseconds for normal contexts
- no blocking React render waiting for network navigation intelligence
- bounded in-memory Rust session lifetime (30 minutes)

These are engineering targets, not measured claims until local profiling confirms them.
