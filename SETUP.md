# Setup Instructions

## Prerequisites

- Rust 1.70+ (install from https://rustup.rs/)
- PostgreSQL 14+ with PostGIS extension
- Node.js 18+ and npm
- Docker and Docker Compose (optional, for containerized deployment)

## Quick Start with Docker

```bash
# Start all services
docker compose up --build -d

# Backend will be available at http://localhost:3001
# Frontend will be available at http://localhost:3000
```

## Manual Setup

### 1. Database Setup

```bash
# Create database
createdb navigation_app

# Enable PostGIS extension
psql navigation_app -c "CREATE EXTENSION postgis;"

# Run migrations
cd backend
sqlx migrate run
```

### 2. Backend Setup

```bash
cd backend

# Optional: create a .env file in the project root for values such as JWT_SECRET.
# The Docker Compose file supplies working development defaults automatically.

# Build and run
cargo build --release
cargo run
```

The backend will start on `http://localhost:3001`.

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend will start on `http://localhost:3000`.

## Configuration

### Environment Variables

**Backend (.env):**
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret key for signing auth tokens. **Must be set to a real
  random value** — accounts created with the insecure default dev value
  aren't safe if that default is ever committed/shared. Sessions last 7
  days; changing this secret invalidates all existing sessions.
- `OSRM_URL`: OSRM routing service URL (Docker default: https://router.project-osrm.org; for local OSRM, set this explicitly)
- `CORS_ORIGIN`: Allowed CORS origin (default: http://localhost:3000)
- Destination autocomplete uses Photon through the backend, with a browser-side Photon fallback if the backend geocoder is unavailable. No `CONTACT_EMAIL` setting is required.

**Frontend (.env):**
- `VITE_API_URL`: Backend API URL (default: http://localhost:3001/api)
The frontend is intentionally **keyless**. The default stack uses
OpenStreetMap for the 2D map, OpenFreeMap for the MapLibre 3D base style,
Mapterhorn for elevation, Photon for place search, and CesiumJS
plus OSM geometry for the immersive turn preview. No map API key or billing
account is required.

## Light/dark theme

Toggleable in the UI (sun/moon button, top-right). Persisted to
localStorage, defaults to the OS/browser's preferred color scheme on first
visit. Both the UI chrome and the map basemap switch together — see
`useTheme.ts` and the `[data-theme='light']` overrides in `App.css`.

## Parking: automatic detection, not manual reservation

There's no "reserve a spot" button — parking_spaces are now capacity-based
lots (`total_spaces`/`occupied_spaces`), and occupancy is inferred
automatically from GPS: sustained low speed near a mapped lot marks the
driver as parked there; sustained movement afterward marks them as having
left. This is a heuristic with no ground-truth signal (no engine-off or
Bluetooth-disconnect event) — see the detection thresholds and their
reasoning in `NavigationView.tsx`. A manual "I've left" button exists as a
fallback for when detection is wrong or slow.

## AR view — a starting point, not full ARKit-grade AR

The "View in AR" button opens a camera + compass overlay showing a
directional arrow toward the next turn or destination. This is
**compass-guided, not true anchored AR** — no SLAM, no 6-DOF tracking,
nothing locked to the road surface the way ARKit/ARCore world tracking
would give you. It's what's buildable in a browser without native iOS/
Android tooling (this project has no Xcode/Android Studio setup). Real
anchored AR would mean a native app — a genuinely separate, larger project.

Device compass heading is genuinely inconsistent across browsers: iOS
Safari needs an explicit permission prompt (triggered by the "Enable
compass" button, not on page load — browsers require a user gesture for
this) and then exposes heading directly; most other browsers have no
permission prompt but also no direct compass reading, only an
approximation from raw device rotation that can drift on uncalibrated
devices. See the comments in `ArOverlay.tsx` for specifics.

## Auth & Accounts

The app requires an account — `POST /api/auth/register` then `/api/auth/login`
(the frontend's login/register screen wraps these). There's no email
verification or password reset flow yet, and sessions are a single
long-lived JWT with no refresh token.

**Billboard moderation & admin access:** every purchased billboard starts in
`pending` moderation status and isn't shown to anyone but the advertiser
until approved. There's no admin UI — approve/reject via:
```bash
curl -X POST http://localhost:3001/api/billboards/<id>/moderate \
  -H "Authorization: Bearer <admin's JWT>" \
  -H "Content-Type: application/json" \
  -d '{"approve": true}'
```
This requires the calling user's `is_admin` flag to be `true` in the
`users` table — there's no signup path for this, set it directly:
```sql
UPDATE users SET is_admin = true WHERE email = 'you@example.com';
```

## Testing

### Backend Tests

Requires a reachable Postgres server with the PostGIS extension installed,
and a role with `CREATEDB` privileges — each test spins up and migrates its
own isolated database (via `#[sqlx::test]`), separate from the app's normal
runtime database.

```bash
cd backend
export DATABASE_URL=postgresql://postgres:postgres@localhost/postgres
cargo test
```

This runs both the unit tests and `tests/integration_test.rs` (covers auth,
parking reservation atomicity under concurrency, report vote thresholds,
and billboard moderation visibility). There's no need to run it separately
with `--test integration_test` — plain `cargo test` picks it up.

### Frontend Tests

```bash
cd frontend
npm test
```

Currently covers the route/geo math in `src/utils/geo.ts` (distance,
bearing, and route-polyline projection calculations) — the code the
split-view trigger, off-route detection, and 3D camera placement all
depend on. Component-level tests (React Testing Library) aren't set up
yet.

## API Documentation

OpenAPI specification is available at `backend/openapi.yaml`.

View interactive docs by serving the YAML file with Swagger UI or similar tools.

## Troubleshooting

### Database Connection Issues

- Ensure PostgreSQL is running
- Verify PostGIS extension is installed: `psql navigation_app -c "\dx"`
- Check DATABASE_URL in backend/.env

### 3D View Not Loading

- Check the browser console for errors loading tiles from `tiles.openfreemap.org` or `tiles.mapterhorn.com`
- If 3D buildings don't appear, the OpenFreeMap 'bright' style's internal source/layer names may have changed — inspect `map.getStyle()` in devtools and adjust the `source`/`source-layer` in the `3d-buildings` layer in `NavigationView.tsx` accordingly

### Parking Reservations Not Working

- Check database transactions are enabled
- Verify PostGIS functions are available
- Check heartbeat TTL configuration

## Production Deployment

1. Set strong `JWT_SECRET` in production
2. Use TLS/HTTPS for all communications
3. Configure proper CORS origins
4. Set up database backups
5. Configure rate limiting
6. Set up monitoring and logging

See `docker-compose.yml` for containerized deployment example.

