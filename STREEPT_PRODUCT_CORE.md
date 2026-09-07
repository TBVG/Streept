# Streept Product Core — Alpha Architecture

Streept is being built as a spatial navigation system rather than a conventional map clone.

## Core state machine

`IDLE → ROUTE_PREVIEW → STARTING → NAVIGATING → APPROACHING_MANEUVER → IMMERSIVE_MANEUVER → NAVIGATING → ARRIVED`

`NAVIGATING → REROUTING → NAVIGATING`

The preview state is never re-entered by an automatic reroute.

## Scene engine

The immersive renderer builds a local driving scene around the next maneuver from:

- route geometry and turn steps
- OpenStreetMap road/building/traffic context
- open terrain
- high-resolution aerial imagery where available
- deterministic procedural fallback geometry

Detail is concentrated around the upcoming maneuver instead of rendering an entire city at maximum detail.

## Production direction

For production scale, replace public runtime OSM/Overpass dependencies with an ingestion pipeline:

`OSM extracts → PostGIS → scene/vector tiles → CDN → Streept clients`

This keeps the application predictable and avoids treating community-funded public endpoints as production infrastructure.

## Platform hardening direction
- Navigation telemetry is local-first and best-effort; it does not block navigation.
- Active traffic is exposed through a stable `/api/traffic` contract so the UI can later swap to a dedicated ingestion pipeline.
- `/ready` verifies database readiness separately from liveness `/health`.
- Backend production CORS is configuration-driven rather than permissive.


## Alpha 62
Spatial + lane intelligence integrated into the working prototype: recommended-lane scoring, lane-aware 3D corridor highlighting, richer road metadata, and building-part handling.
