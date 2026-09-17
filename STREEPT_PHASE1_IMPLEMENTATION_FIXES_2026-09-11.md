# Streept — Phase 1 Implementation Fixes

Date: 2026-09-11

This pass focuses on actual application code/configuration problems. It is not a claim that Docker, Rust, or the full dependency-backed browser suite has been executed in this environment.

## Fixed

1. **WebSocket reverse-proxy path**
   - Backend WebSocket route is `/api/ws` because the API router is nested under `/api`.
   - Nginx previously proxied `/ws` to backend `/ws`.
   - Fixed proxy target to `/api/ws`.

2. **Service-worker runtime cache eviction**
   - Activation previously deleted every cache except the shell cache.
   - That also deleted the runtime API/static cache on every service-worker activation.
   - Runtime cache is now preserved during activation.

3. **Navigation intelligence type mismatch**
   - Presentation logic compared a junction priority against `high`, but the declared junction priority union does not contain that value.
   - The high-attention decision now uses the numeric intelligence score threshold that is part of the presentation contract.

4. **Navigation-core dependency-independent typecheck**
   - The check previously reached Axios through transitive imports without a dependency-independent type declaration.
   - Added a temporary typed Axios shim and the Vite environment declaration to the check.
   - The shell check passes with the available global TypeScript compiler.

5. **Axios request interceptor robustness**
   - The guest/request ID interceptor now initializes `config.headers` before writing custom headers.

6. **Docker scene-tile build configuration**
   - Added `VITE_SCENE_TILE_URL` as a frontend Docker build argument and Compose build argument so the existing scene-tile CDN configuration can actually reach a production frontend build.

7. **Routing URL normalization**
   - Backend route construction now strips trailing `/` from `OSRM_URL`, preventing malformed `//route/v1/...` URLs when operators configure the provider with a trailing slash.

8. **Stale configuration cleanup**
   - Removed the unused `CONTACT_EMAIL` Compose environment variable.
   - Updated the setup documentation to describe the currently implemented Photon geocoder rather than an unimplemented Nominatim fallback.

## Validation performed here

- Frontend JSON configuration files parse successfully.
- Relative frontend imports resolve successfully.
- Shell scripts pass `bash -n` syntax validation.
- Dependency-independent navigation-core TypeScript check passes.

## Still requires a machine with the project toolchain

- `npm install` / full frontend typecheck and production build
- Vitest suite
- Playwright browser E2E suite
- Rust/Cargo build and tests
- Docker Compose build/startup
- PostgreSQL migration execution
- Live API/WebSocket/routing/geocoder runtime checks
