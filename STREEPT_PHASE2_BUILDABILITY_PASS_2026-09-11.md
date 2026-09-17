# Streept Phase 2 — Buildability Pass

Date: 2026-09-11

## Scope

This pass targets build/startup integration problems in the Phase 1 implementation. It fixes issues that could prevent the Docker/dev build from matching the actual project structure and removes environment drift between local development and CI.

## Implementation fixes

1. **Fixed Dockerfile lockfile COPY failures**
   - The project did not contain `frontend/package-lock.json` or `backend/Cargo.lock`.
   - Both Dockerfiles previously used wildcard COPY instructions that could fail when the optional lockfile did not exist.
   - Dockerfiles now copy the manifests that are actually present and let the package managers resolve dependencies during the image build.

2. **Upgraded and aligned the frontend Node runtime**
   - Frontend Docker builder moved from Node 18 Alpine to Node 22.16 Alpine.
   - CI now uses Node 22 as well.
   - `frontend/package.json` declares Node 22 as its supported engine range.

3. **Pinned direct frontend dependency versions**
   - Removed caret ranges from direct dependencies/devDependencies so future installs do not silently move to newer major/minor versions.
   - A committed npm lockfile is still recommended for fully reproducible installs; it could not be generated in this environment because dependency resolution timed out without usable package-registry access.

4. **Fixed WebSocket behavior in Vite development**
   - `/ws` is now rewritten by the Vite dev proxy to the backend's real `/api/ws` endpoint.
   - The example direct-backend WebSocket URL was corrected to `/api/ws`.
   - This aligns local development with the production nginx routing fixed in Phase 1.

5. **Made backend Compose healthcheck verify readiness**
   - Backend healthcheck now calls `/ready` instead of `/health`.
   - `/ready` performs a real `SELECT 1`, so dependent services do not treat a backend with an unavailable database as ready.

6. **Pinned the Rust build image patch version**
   - Backend builder moved from floating `rust:1.98-bookworm` to `rust:1.98.1-bookworm`.
   - The tag is currently published by the official Rust Docker image. See Docker Hub source: https://hub.docker.com/_/rust/.

7. **Added a buildability-check helper**
   - `scripts/buildability-check.sh` performs Docker Compose config validation when Docker is available, checks the frontend manifest, validates shell syntax, and runs the frontend production build when npm is available.

## Checks performed here

- `package.json` JSON parse: PASS
- `docker-compose.yml` YAML parse: PASS
- shell syntax checks: PASS
- local import/config inspection: PASS
- Docker/Rust runtime build: **NOT RUN** — Docker and Rust/Cargo are not installed in this environment
- full npm production build: **NOT RUN** — dependency installation could not complete because package-registry access timed out
- backend integration tests: **NOT RUN** — Cargo/PostgreSQL runtime unavailable

## Important remaining item

The project still does not contain `package-lock.json` or `Cargo.lock`. Phase 2 makes the existing Dockerfiles buildable without those files, but a subsequent reproducibility pass should generate and commit both lockfiles after a successful dependency resolution/build environment is available.
