# Streept Phase 4 — Data Convergence & Runtime Integrity

## What changed

Phase 4 continues from the Phase 3 runtime-integration build and focuses on a real correctness problem in live traffic state: REST snapshots and WebSocket deltas can arrive in a different order.

### Frontend
- Added short-lived deletion tombstones to `LiveTrafficStream` for reports and telemetry vehicles.
- Prevented an already-in-flight REST snapshot from immediately resurrecting an object that was removed through WebSocket.
- Preserved the existing timestamp ordering for updates.
- Added regression tests covering report and vehicle resurrection after deletion.
- Added tombstone cleanup so the convergence layer does not grow without bound.

### Backend
- `TrafficVehicleStore::upsert` now compares `observed_at` before replacing an existing vehicle observation.
- An older provider observation can no longer overwrite a newer lane/speed/position observation merely because it arrived later.

## Verification performed in this environment
- `scripts/verify-navigation-core.sh`: PASS.
- The modified TypeScript source was checked through the existing navigation-core TypeScript verification path.
- Full Vitest, Vite production build, Rust compilation, Docker Compose integration, PostgreSQL integration, and Playwright browser tests require the project's dependency/runtime environment and are not claimed as executed here.

## Phase 4 boundary
This phase is an implementation pass, not a claim that the complete product is production-ready. The next runtime pass should execute the full dependency-enabled test/build stack and fix any failures it exposes rather than adding another test-only layer.
