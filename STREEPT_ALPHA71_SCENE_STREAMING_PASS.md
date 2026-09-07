# Streept Alpha 71 — Scene Streaming & High-Detail Bubbles

## Completed

- Added a bounded, TTL-aware LRU model for immersive street-scene caching.
- Cache entries now track both freshness and recent use so frequently revisited
  maneuver bubbles survive longer than cold entries.
- Increased the client scene cache ceiling to 48 bounded entries while keeping
  the existing 10-minute freshness policy.
- Added deterministic spatial prefetch helpers for future high-detail bubbles:
  a maneuver center plus a compact north/south/east/west ring.
- Limited active maneuver prefetch to four targets, preventing scene streaming
  from becoming an unbounded network workload.
- Preserved IndexedDB/offline scene persistence and server-side scene tiles.

## Architecture direction

The immersive renderer now has the primitives needed for a streaming scene
pipeline: deterministic scene keys, bounded memory, persisted warm scenes, and
spatially local prefetch. A later pass can replace HTTP scene bubbles with a
CDN/object-store tile source without changing navigation lifecycle behavior.

## Validation

Changed TypeScript files were syntax-checked with the installed TypeScript
compiler. Full dependency installation/build remains environment-dependent.
