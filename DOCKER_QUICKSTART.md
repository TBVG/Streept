# Docker quick start

From this directory:

```bash
docker compose up --build
```

Then open:

- Frontend: http://localhost:3000
- Backend health: http://localhost:3001/health

To stop it:

```bash
docker compose down
```

To remove the development PostgreSQL data as well:

```bash
docker compose down -v
```

## What was fixed

1. The backend service previously bind-mounted `./backend:/app`. That
   replaced the `/app` directory from the image at runtime, hiding the
   compiled `/app/navigation-backend` binary and `/app/migrations`.
2. SQLx's `migrate!` macro was used by the backend, but the normal
   `sqlx` dependency did not enable the `migrate` feature. This could make
   the backend fail to compile in a release Docker build.
3. Docker ignore files were added so local `target`, `node_modules`, and
   environment files are not copied into build contexts.
4. The setup documentation now uses modern `docker compose` and no longer
   references missing `.env.example` files.

The frontend remains a Vite development container on port 3000, while
PostgreSQL is initialized automatically, backend migrations run at
startup, and the default routing URL points at the public OSRM demo service.
For production, provide your own `OSRM_URL` service instead of relying on a
public demo endpoint.

## Immersive turn preview

Streept now has a separate immersive turn-preview renderer. When live navigation approaches a complex maneuver, the UI automatically enters split view: the normal map remains on the left and a low-altitude, first-person CesiumJS scene appears on the right.

The immersive renderer is intentionally key-free. CesiumJS is loaded from the official public build at runtime, OpenStreetMap raster tiles provide the geographic skin, and the route/maneuver geometry comes from the existing OSRM/OpenStreetMap-based routing pipeline. The scene adds lightweight procedural roadside massing near the route so the preview remains useful without requiring paid photogrammetry or Cesium ion.

This first milestone is a foundation for replacing the procedural massing with richer open 3D building data later; it does not claim photorealistic Google-style street imagery.

### Immersive scene context

The first-person turn pane is key-free. Streept's backend fetches a small OpenStreetMap/Overpass context around the upcoming maneuver and caches it briefly. Public Overpass instances are shared infrastructure, so the app deliberately avoids polling them from the GPS/render loop.
