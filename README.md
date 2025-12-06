# Advanced Navigation App

A web application featuring 2D navigation with automatic first-person 3D views at key contextual points (turns, exits, complex junctions), powered by CesiumJS.

## Architecture

- **Backend**: Rust (Axum) with async/await
- **Database**: PostgreSQL + PostGIS for geospatial queries
- **Frontend**: React + TypeScript + CesiumJS
- **Real-time**: WebSockets for live updates
- **Routing**: OSRM/GraphHopper integration
- **Authentication**: JWT/OAuth2

## Features

### MVP (Phase 1)
- ✅ 2D navigation with turn-by-turn instructions
- ✅ Automatic split-screen UI at contextual points
- ✅ First-person 3D view using CesiumJS
- ✅ 3D route highlighting (blue road surfaces)
- ✅ Atomic parking occupancy with heartbeat TTL
- ✅ Community reporting (cops, hazards, construction, etc.)
- ✅ Billboard discovery and ad purchase/display

### Core Behaviors

**Split View**: Automatically activates at turns, complex exits, and junctions:
- Left pane: Standard 2D map + navigation instructions
- Right pane: First-person 3D perspective from user's position

**Parking System**:
- Atomic reservations with transaction protection
- Heartbeat mechanism (expires after X minutes of inactivity)
- Pending state during reservation
- Real-time availability updates

**Community Reports**:
- Types: cops, hazards, construction, accidents, traffic jams, closed lanes
- Location-based broadcasting to nearby users
- Displayed on both 2D map and 3D view
- Auto-expiration based on timestamps

**Billboards**:
- Discovery and highlighting in 3D/2D views
- Purchase/reservation system (free for MVP)
- Ad creative upload (image/URL)
- Click-through tracking
- Display time windows

## Technology Stack

- **Backend**: Rust, Axum, SQLx, PostGIS
- **Frontend**: React, TypeScript, CesiumJS, Leaflet/Mapbox
- **Database**: PostgreSQL 14+ with PostGIS extension
- **Real-time**: WebSockets (via Axum)
- **Routing**: OSRM (or GraphHopper/Valhalla)

## Setup

### Prerequisites
- Rust 1.70+
- PostgreSQL 14+ with PostGIS
- Node.js 18+ (for frontend)
- Docker (optional, for containerized deployment)

### Backend Setup

```bash
cd backend
cargo build
# Set DATABASE_URL in .env
cargo run
```

### Database Setup

```bash
# Create database and enable PostGIS
createdb navigation_app
psql navigation_app -c "CREATE EXTENSION postgis;"

# Run migrations
cd backend
sqlx migrate run
```

### Frontend Setup

```bash
cd frontend
npm install

# Note: Cesium requires additional setup
# If using npm, you may need to copy Cesium assets:
# cp -r node_modules/@cesium/engine/Build/Cesium public/cesium
# Or configure Vite to serve Cesium assets properly

npm run dev
```

## API Documentation

See `backend/openapi.yaml` for complete OpenAPI specification.

### Core Endpoints

- `GET /api/parking?destination=<lat>,<lng>` - Get available parking near destination
- `POST /api/parking/reserve` - Reserve a parking spot (atomic)
- `POST /api/parking/heartbeat` - Update reservation heartbeat
- `GET /api/reports?lat=<lat>&lng=<lng>&radius=<meters>` - Get nearby reports
- `POST /api/reports` - Create a new report
- `GET /api/billboards?lat=<lat>&lng=<lng>&radius=<meters>` - Get nearby billboards
- `POST /api/billboards/:id/purchase` - Purchase billboard ad space
- `GET /api/route?from=<lat>,<lng>&to=<lat>,<lng>` - Get route with 3D highlight data
- `WS /ws` - WebSocket connection for real-time updates

## Configuration

### Environment Variables

```env
DATABASE_URL=postgresql://user:pass@localhost/navigation_app
JWT_SECRET=your-secret-key
OSRM_URL=http://localhost:5000
PARKING_HEARTBEAT_TTL_MINUTES=15
CORS_ORIGIN=http://localhost:3000
```

### Parking Heartbeat TTL

Default: 15 minutes. If no heartbeat is received within this window, the parking reservation expires and the spot becomes available again.

## Testing

```bash
# Backend tests
cd backend
cargo test

# Integration tests
cargo test --test integration

# Frontend tests
cd frontend
npm test
```

## Deployment

Docker Compose setup included:

```bash
docker-compose up -d
```

See `docker-compose.yml` and `Dockerfile` files for details.

## Performance Targets

- <200ms median UI interaction time
- Support 1000+ concurrent users per region (MVP)
- Accurate geospatial queries with PostGIS indexing

## Security

- TLS required for all communications
- JWT-based authentication
- Rate limiting on reports and ad purchases
- Minimal location history storage
- Privacy policy and opt-out mechanisms

## License

Licensed under the Apache License, Version 2.0

