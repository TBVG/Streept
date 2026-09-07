# Streept immersive turn navigation

## Product behavior

Streept keeps three distinct experiences:

1. **Normal navigation** — the existing 2D map and turn-by-turn UI.
2. **Immersive turn preview** — automatically switches to split view near a complex maneuver. The left pane remains the 2D route; the right pane is a low-altitude first-person CesiumJS scene.
3. **AR mode** — the existing camera/compass overlay remains separate and is still available from the navigation panel.

## Free-data architecture

- **CesiumJS**: open-source 3D rendering engine, loaded at runtime from the official CesiumJS distribution. No Cesium ion account/token is required by this implementation.
- **OpenStreetMap**: geographic road/route data and the raster map skin used by the immersive globe.
- **OSRM**: existing routing service in the Streept backend.
- **Procedural context massing**: lightweight 3D roadside blocks are generated from the real route geometry as a key-free fallback where an open 3D building mesh is not available.

## Why procedural massing is deliberate

A free global source that simultaneously provides photorealistic street-level imagery, complete 3D buildings, permissive production hosting, and unlimited anonymous API access does not exist at Google's quality level. Streept therefore focuses detail on the next maneuver instead of trying to stream a photorealistic copy of an entire city.

The current renderer now requests only the next-turn corridor from OpenStreetMap's public Overpass service and extrudes real OSM building footprints using height/building-level tags when available. Results are cached in-memory per maneuver; if the public service is unavailable, the renderer falls back to lightweight procedural context. This keeps the feature key-free while making the visible turn area geographically faithful.

### Free scene-data path (v4)

The browser no longer calls Overpass directly. The immersive renderer requests `/api/scene-context` from Streept's backend. The backend combines buildings, roads, traffic signals, crossings and stop signs into one maneuver-local query, rounds the location into a cache key, and keeps the result for 10 minutes. This reduces repeated public-API traffic while preserving the no-key/no-paid-service requirement.

The scene is intentionally bounded to the upcoming junction: up to 700 buildings, 300 road features, 40 signals/crossings and 30 stop signs. Road names are rendered as short-lived 3D labels near the camera. If the OSM request fails, the renderer falls back to its procedural scene so navigation does not disappear.

## Navigation UI refresh

The immersive turn preview now uses a navigation-app-inspired visual system: a dark lane-guidance header, blue highlighted route, charcoal asphalt, green roadside verge, white/yellow road markings, a compact trip summary, and right-side controls. This is an original Streept interface inspired by modern navigation conventions rather than a copy of any single product.

The 2D/3D split remains separate from the existing AR camera mode. The immersive renderer continues to use open geographic data and does not require a paid API key.
