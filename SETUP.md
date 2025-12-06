# Setup Instructions

## Prerequisites

- Rust 1.70+ (install from https://rustup.rs/)
- PostgreSQL 14+ with PostGIS extension
- Node.js 18+ and npm
- Docker and Docker Compose (optional, for containerized deployment)

## Quick Start with Docker

```bash
# Start all services
docker-compose up -d

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

# Copy environment file
cp .env.example .env

# Edit .env with your database URL and configuration
# DATABASE_URL=postgresql://user:password@localhost/navigation_app

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

# Copy environment file (optional)
cp .env.example .env

# Start development server
npm run dev
```

The frontend will start on `http://localhost:3000`.

## Configuration

### Environment Variables

**Backend (.env):**
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret key for JWT tokens
- `OSRM_URL`: OSRM routing service URL (default: http://localhost:5000)
- `PARKING_HEARTBEAT_TTL_MINUTES`: Parking reservation TTL (default: 15)
- `CORS_ORIGIN`: Allowed CORS origin (default: http://localhost:3000)

**Frontend (.env):**
- `VITE_API_URL`: Backend API URL (default: http://localhost:3001/api)

## Testing

### Backend Tests

```bash
cd backend
cargo test
```

### Integration Tests

```bash
cd backend
cargo test --test integration
```

### Frontend Tests

```bash
cd frontend
npm test
```

## API Documentation

OpenAPI specification is available at `backend/openapi.yaml`.

View interactive docs by serving the YAML file with Swagger UI or similar tools.

## Troubleshooting

### Database Connection Issues

- Ensure PostgreSQL is running
- Verify PostGIS extension is installed: `psql navigation_app -c "\dx"`
- Check DATABASE_URL in backend/.env

### Cesium 3D View Not Loading

- Ensure Cesium assets are properly served
- Check browser console for Cesium-related errors
- Verify Cesium Ion token if using Ion services

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

