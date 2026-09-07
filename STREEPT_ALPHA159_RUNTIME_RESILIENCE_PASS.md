# Streept Alpha 159 — Runtime Resilience Pass

This pass hardens the live navigation runtime around transient infrastructure failures.

## Changes

- WebSocket reconnects now use exponential backoff with bounded jitter instead of a fixed 3-second retry. Successful connections reset the retry streak.
- The immersive renderer records frame timings through the production `RuntimeFrameMonitor`, giving the existing QA health contract a live frame-budget signal and resetting it with the renderer lifecycle.
- The in-process backend rate limiter opportunistically removes expired client entries once the key set grows large, preventing unbounded memory growth from one-off peer addresses.

## Validation

- Source-level TypeScript transpilation should be run in an environment with the frontend toolchain installed.
- Rust compilation should be run in an environment with Cargo installed.
