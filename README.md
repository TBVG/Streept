# Streept

A community-driven navigation web app: turn-by-turn directions with an
automatic first-person 3D cutaway at turns, live parking availability
detected from GPS (not manually reserved), crowd-sourced hazard/police/
traffic reports with confirm/dismiss voting, and roadside billboard ads
with moderation. Built as a real product exploration, not a demo — real
auth, real rate limiting, real tests, real CI.

**Status: immersive navigation architecture complete; current work is product-wide production hardening and release validation.** The project has
been checked for Docker/runtime configuration issues. The most important
fix was removing a backend bind mount that hid the compiled Rust binary at
runtime, and enabling SQLx migrations in the normal backend dependency set.
A local Docker daemon/compiler was not available in this environment, so
run `docker compose up --build` on a machine with Docker to perform the
final end-to-end container build.

## What it actually does

- **Turn-by-turn navigation** with a route picker (2–3 alternatives with
  time/distance tradeoffs, when the underlying routing engine — OSRM —
  provides them), lane guidance before turns (which lane to be in, when
  the map data has it), and a heading-aware vehicle icon.
- **Automatic 2D→3D split view** at turns and complex junctions: the
  right pane opens a first-person MapLibre GL 3D cutaway of the
  intersection, camera oriented the way the driver is actually
  approaching it — proximity-triggered using real distance-along-the-route
  math, not just "turn exists nearby."
- **A lightweight AR mode**: camera + compass overlay showing a
  directional arrow toward the next turn or destination. Explicitly not
  full ARKit/ARCore-grade anchored AR (no SLAM, nothing locked to the road
  surface) — that would need a native app, which doesn't exist here.
- **Parking, detected not reserved**: lots have a capacity and an occupied
  count; the app infers when you've parked from sustained low GPS speed
  near a mapped lot, and when you've left from sustained movement
  afterward. No manual "reserve a spot" button — nobody can actually
  reserve a public parking spot in real life, only report/detect that
  it's taken.
- **Community reports** (police, hazards, construction, accidents, traffic
  jams, closed lanes) with confirm/dismiss voting — a confirmation extends
  a report's lifetime, enough dismissals expire it immediately.
- **Billboards**: book roadside ad space, rendered as real 3D panels in
  the split-view pane near the route. Every purchase starts in a
  `pending` moderation state and isn't shown to anyone but the advertiser
  until an admin approves it — there's no automated image moderation, this
  is a manual gate.
- **Real-time updates** over WebSocket: someone else takes a parking spot,
  files a report, or votes on one — it shows up live for nearby users,
  geo-filtered so you only get updates relevant to where you actually are.
- **Destination search** with autocomplete (via Nominatim/OpenStreetMap),
  a two-field start+destination flow like Google/Apple Maps (with swap),
  and recent-destination memory.
- **Accounts**: real registration/login, argon2-hashed passwords, JWT
  sessions — not anonymous client-generated IDs.
- **Light/dark theme**, toggleable, persisted, matching both the UI chrome
  and the map basemap.
- **Offline-aware**: turn-by-turn keeps working with zero connectivity
  (it's client-side math against an already-loaded route) — search,
  rerouting, and live updates correctly pause and resume instead of
  silently failing or spamming reconnect attempts.

## Architecture

- **Backend**: Rust, Axum, SQLx (PostgreSQL + PostGIS for geospatial
  queries), split into a library crate (`lib.rs`) + thin binary, so
  integration tests can actually exercise the handlers directly.
- **Frontend**: React + TypeScript + Vite. MapLibre GL JS for the 3D pane,
  Leaflet for the 2D pane.
- **Real-time**: a `tokio::sync::broadcast` channel on the backend, fanned
  out over WebSocket connections geo-filtered per-client.
- **Auth**: argon2 password hashing, JWT sessions (7-day, no refresh
  token yet).
- **Rate limiting**: hand-rolled, per-IP, applied per-route — not a
  third-party crate, specifically to avoid depending on an
  axum/tower-version compatibility this environment couldn't verify.
- **Design system**: CSS custom properties (`App.css`) driving both light
  and dark themes from the same component styles — an "asphalt and
  lane-marking" visual language (see `PROJECT_SUMMARY.md` for the design
  reasoning), Barlow + Public Sans typography.
- **Testing**: `#[sqlx::test]`-based Rust integration tests (isolated,
  auto-migrated databases per test) covering auth, parking-count
  concurrency, report-vote thresholds, and billboard moderation; Vitest
  unit tests covering the route/geo math (distance, bearing, polyline
  projection) that the split-view trigger and reroute detection depend on.
- **CI**: GitHub Actions runs both suites against a real
  `postgis/postgis` service container on every push.

### Free-by-default, keyless

The default map/search stack is keyless: OpenStreetMap for the 2D basemap,
OpenFreeMap for the MapLibre base style, Mapterhorn for elevation, and
Photon with Nominatim fallback for place search. No third-party map key is
needed. The immersive turn preview uses CesiumJS and OSM geometry. The production frontend container builds the Vite app once and serves the compiled SPA through nginx, with same-origin `/api` and `/ws` reverse proxies to the backend.

## Known gaps and honest limitations

- **Nothing has been run.** No compiler, no browser, no database in this
  environment. This is the single biggest caveat on the whole project.
- **AR is compass-guided, not anchored.** Real ARKit/ARCore-grade AR needs
  a native app (Swift/Xcode or Kotlin/Android Studio), which this project
  doesn't have.
- **3D world reconstruction is still stylized** — OSM building massing and lightweight roadside objects are rendered without photorealistic textures or
  satellite imagery. Alpha 137 adds physical roadside signage; deeper driver-first road/junction reconstruction is next.
- **No payment processing.** Billboard "purchases" book ad space but don't
  charge anyone.
- **The rate limiter is in-memory, per-process** — won't coordinate across
  multiple backend replicas if this is ever scaled horizontally.
- **No email verification or password reset flow.**
- **Free third-party services carry real usage constraints** — Nominatim
  in particular caps requests at 1/second *application-wide* (not
  per-user), which the backend enforces with a dedicated request gate; see
  `backend/src/geocode.rs`.

## Setup

See **`SETUP.md`** for full instructions (Docker and manual paths,
environment variables, testing, and the reasoning behind several of the
above design decisions). Quick version:

### Prerequisites
- Rust 1.70+
- PostgreSQL 14+ with PostGIS
- Node.js 18+
- Docker (optional, for containerized deployment)

### Backend

```bash
cd backend
export DATABASE_URL=postgresql://postgres:postgres@localhost/navigation_app
export JWT_SECRET=some-random-string-for-dev
cargo run
```

### Database

```bash
createdb navigation_app
psql navigation_app -c "CREATE EXTENSION postgis;"
```

Migrations run automatically on backend startup.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## API

`backend/openapi.yaml` is maintained alongside the API surface; it documents the current routes below and intentionally does not expose the removed parking-reservation API.

### Core Endpoints

- `POST /api/auth/register` / `POST /api/auth/login` - Account creation and sessions
- `GET /api/geocode?q=<query>` - Destination search (Nominatim-backed)
- `GET /api/parking?destination=<lat>,<lng>` - Nearby lots with occupancy counts
- `POST /api/parking/checkin` / `POST /api/parking/checkout` - Auto-called by GPS detection, not manual
- `POST /api/parking/heartbeat` - Keep a check-in alive while parked
- `GET /api/reports?lat=<lat>&lng=<lng>&radius=<meters>` - Nearby reports
- `POST /api/reports` - Create a report
- `POST /api/reports/:id/confirm` / `POST /api/reports/:id/dismiss` - Vote on a report
- `GET /api/billboards?lat=<lat>&lng=<lng>&radius=<meters>` - Nearby billboards
- `POST /api/billboards/:id/purchase` - Book billboard ad space (starts `pending` moderation)
- `POST /api/billboards/:id/click` - Click-through tracking
- `POST /api/billboards/:id/moderate` - Admin-only approve/reject
- `GET /api/route?from=<lat>,<lng>&to=<lat>,<lng>` - Route(s) with 3D highlight + lane guidance data
- `WS /ws` - Real-time updates (geo-filtered per connection)

## Testing

```bash
# Backend — requires a Postgres server your role can CREATE DATABASE on
cd backend
export DATABASE_URL=postgresql://postgres:postgres@localhost/postgres
cargo test

# Frontend
cd frontend
npm test
```

CI (`.github/workflows/ci.yml`) runs both automatically on push.

## Deployment

```bash
docker-compose up -d
```

See `docker-compose.yml` and the `Dockerfile`s in `backend/`/`frontend/`.

## License

Licensed under the Apache License, Version 2.0


### Search and location behavior

Destination autocomplete uses the free Photon OpenStreetMap geocoder. Searches are lightly biased toward the current GPS position but also retain a global query so a destination such as “Times Square” can be found even when the driver is far away. The backend caches searches and the browser has a provider fallback. Nominatim is intentionally not used for autocomplete because its public service explicitly prohibits client-side autocomplete.

The map automatically flies to the first valid GPS fix after startup. A location button in the lower-right corner re-centers the map on the current position without repeatedly stealing manual pan/zoom control.

## Current 3D milestone

**Alpha 138 — Driver-First 3D Road Geometry (complete).**

Streept's immersive turn view now treats the physical road as the primary navigation surface. The immediate route lane receives a lightweight physical highlight, the recommended/current/destination lane is preferred when lane metadata is available, and the upcoming junction branch is emphasized using the same physical connector topology used by lane intelligence. This sits on top of the existing streamed OSM road/building context, live traffic, roadside infrastructure, billboards, scene LOD, and adaptive render-quality systems.

**Alpha 139 — Junction Comprehension & Driver Cues is complete.** Complex junctions now receive explicit approach, decision, and exit cue zones; selected physical branches stay dominant while alternatives remain muted; and the cue hierarchy reinforces the driver-first lane surface and existing lane/sign/maneuver guidance without turning the whole scene into UI. **Alpha 140 — Route-Ahead Visual Continuity is complete.** The driver-first road surface now carries a restrained physical continuity bridge toward the next maneuver, stopping before the next decision zone so junction cues can take over without competing visual emphasis. Deterministic validation covers consecutive maneuvers and final-maneuver behavior. The next focus is **Alpha 143 — Adaptive Scene Confidence**.

**Alpha 142 — Predictive Junction Approach is complete.** Immersive junction cues now use physical driver distance and live speed to tune preparation timing and prominence. Fast approaches get earlier bounded preparation, slow/stop-and-go traffic keeps a useful spatial runway without lighting the route too far ahead, and nearby decisions become progressively stronger. The predictive model is renderer-neutral and deterministic. 
**Alpha 141 — Multi-Maneuver Scene Choreography is complete.** Current, next, and following maneuvers now share one renderer-neutral priority stack. Closely spaced decisions compress the next preparation window and suppress a following preview when there is not enough physical road to make it useful. The existing physical route-ahead surface is reused rather than adding another visual overlay.

**Alpha 143 — Adaptive Scene Confidence (complete).** Immersive guidance now scales visual authority using lane-match, junction-topology, GPS proximity, and scene-coverage confidence. Uncertain guidance is deliberately quieter rather than being presented as a high-confidence physical claim. **Alpha 144 — Confidence-Aware Route Recovery is complete.** Confidence drops now enter a reversible recovery state: lane/GPS uncertainty is distinguished from stale scene context, physical guidance remains continuous but restrained, and freshly fetched scene timestamps let the renderer avoid presenting old map context with full authority. The next focus is **Alpha 145 — Driver Trust & Guidance Fallback**.
**Alpha 145 — Driver Trust & Guidance Fallback is complete.** The immersive renderer now uses an explicit lane → junction → route → maneuver trust hierarchy. When lane matching is weak, lane geometry is restrained; when physical junction topology remains reliable it can carry the guidance; when that also becomes uncertain, Streept preserves route continuity without pretending to know the exact lane or branch. Severe uncertainty suppresses physical claims and leaves the maneuver instruction authoritative. The next focus is **Alpha 146 — Guidance Consistency & Transition Smoothing**.

**Alpha 147 — Uncertainty-Aware Scene Composition is complete.** Scene confidence, recovery state, and guidance fallback now feed one deterministic composition policy. Trusted driver guidance remains prominent while uncertain OSM world context, traffic, infrastructure, and billboard detail become visually subordinate rather than disappearing. The composition also bounds world detail during degraded states and preserves route continuity through recovery.


### Alpha 148 — Scene Freshness & Recovery Continuity
Streept now tracks 3D scene freshness explicitly, progressively subordinates aging world context, invalidates stale cached maneuver scenes, and reacquires them without removing route continuity.

## Alpha 150 status
Predictive scene prefetch is complete. Streept now forecasts near-future 3D scene demand from route geometry, speed and heading, biases bubble reacquisition toward the forward driving corridor, and combines predictive targets with the existing route-ahead safety net. Alpha 149's warm/handoff lifecycle remains responsible for seamless overlap and retirement.


## Alpha 152 status
Cross-bubble scene objects now use stable OSM/node/geometry identities and duplicate scene records are removed before chunk rendering.


## Local verification

From the repository root, run `scripts\verify.ps1` on Windows PowerShell or `./scripts/verify.sh` on macOS/Linux. The verification flow installs frontend dependencies, runs the Vitest suite, builds the production frontend, validates Docker Compose, starts PostgreSQL + backend + nginx, and waits for both health endpoints. The Docker stack is intentionally left running after a successful smoke test so the app can be opened at `http://localhost:3000`.
