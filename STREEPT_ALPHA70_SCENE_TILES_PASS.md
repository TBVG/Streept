# Streept Alpha 70 — Server-Side Scene Tile Pass

## Completed

- Added a server-side `SceneTileStore` that can load pre-generated OSM scene tiles from `STREEPT_SCENE_TILES_FILE`.
- Added deterministic Web-Mercator tile addressing for scene data.
- Added `GET /api/scene-tile`, which serves only pre-generated scene data and never contacts public OSM services.
- Updated `/api/scene-context` to prefer a local pre-generated scene tile before its existing development Overpass fallback.
- Added an example empty scene-tile file and documented the runtime contract in code.

## Deployment model

Production deployments should generate/import scene tiles from an OSM extract and set `STREEPT_SCENE_TILES_FILE` to the resulting JSON file. Runtime navigation can then use `/scene-tile` or `/scene-context` without querying public Overpass.

The Overpass fallback remains intentionally available for development environments that have no local extract yet.
