# Streept Phase 3 — Runtime Integration Fixes

Date: 2026-09-11

## Actual implementation changes

- Hardened WebSocket URL resolution in `frontend/src/services/api.ts`.
  - Same-origin production uses the nginx public `/ws` path.
  - Direct backend development uses `/api/ws`.
  - Explicit `VITE_WS_URL` remains authoritative.
- Changed nginx WebSocket routing to an exact `/ws` location so unrelated `/ws/...` paths are not accidentally upgraded/proxied.
- Corrected the production environment example to use the backend's actual `/api/ws` path when the WebSocket is configured directly against an API origin.
- Improved spatial-intelligence REST error handling so non-2xx responses surface the backend's JSON error message when available instead of only an HTTP status.
- Re-ran the dependency-independent navigation-core TypeScript check: PASSED.

## Verification boundary

This pass is an implementation/integration hardening pass. Full browser, Docker, Rust, PostgreSQL, and external-provider runtime verification still requires the project's local dependency/runtime environment.
