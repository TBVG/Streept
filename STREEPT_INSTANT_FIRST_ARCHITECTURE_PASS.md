# Streept instant-first architecture pass

## Core product invariant

Streept should never block the user behind a full-page loading state when a
usable local result can be shown. External work is progressive and
background-first.

## Route critical path

1. Check the local IndexedDB trip cache.
2. If a valid route exists, commit it immediately.
3. Start live routing in the background.
4. Commit fresh routing immediately when it arrives.
5. Run Rust route intelligence asynchronously after the route is usable.
6. Run community intelligence and map-tile warming asynchronously.

This makes network latency an enrichment concern rather than a prerequisite
for displaying a previously known route.

## Rust invariant

Rust is the sole route-ranking/navigation-policy implementation. The old
TypeScript route scorer is not used as a fallback because duplicate decision
engines waste CPU and can disagree. A Rust intelligence failure leaves the
base route intact.

## UI invariant

The map is never covered by a route-loading overlay. Route status belongs in
the existing route card; the map and the rest of the application remain
interactive while background work completes.

## Remaining performance work

Actual latency and memory targets still require local profiling. In particular,
we should measure cold startup, warm route-cache hit time, live routing time,
Rust decision latency, GPS update cost, browser memory, and renderer FPS before
claiming a numeric speedup.
