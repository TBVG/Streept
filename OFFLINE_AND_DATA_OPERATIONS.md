# Streept offline and spatial-data operations

## Self-hosted routing

1. Obtain an OSM PBF for the region you want to operate offline.
2. Run `scripts/prepare-osrm.ps1 <region.osm.pbf>` on Windows or `scripts/prepare-osrm.sh <region.osm.pbf>` on Linux/macOS.
3. Start the optional routing service with `docker compose --profile routing up -d osrm`.
4. Set `ROUTING_URL=http://localhost:5000` and optionally `ROUTING_FALLBACK_URL`.

## Server-side 3D scene shards

Generate a normal `SceneTile[]` JSON export, then run:

`python scripts/split-scene-tiles.py scenes.json ./scene-data`

Set `STREEPT_SCENE_TILES_FILE=./scene-data` (or the mounted container path). The backend now accepts either one JSON export or a directory of JSON shards.

## Browser offline maps

After a route is built, Streept prefetches a bounded corridor of map tiles and stores them in the browser Cache API. The service worker serves those cached tiles when the network disappears. This is deliberately bounded; a production deployment must use a map provider whose terms explicitly permit the desired offline caching/distribution model.
