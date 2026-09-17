# Streept Phase 6 — Basemap Access Fix — 2026-09-16

## Problem
The previous key-free build switched the Leaflet 2D map to OpenStreetMap's public raster tile server. The running app received HTTP 403/blocked tile responses, causing the repeated `Access blocked` tiles visible in the UI.

## Fix
- Removed direct `tile.openstreetmap.org` raster requests from the 2D Leaflet map.
- Switched the 2D map to Esri World Dark Gray Base + World Dark Gray Reference raster services.
- Kept the dark navigation appearance natively in the basemap instead of CSS-inverting OSM tiles.
- Added the required provider attribution for Esri/HERE/OpenStreetMap contributors/GIS user community.
- Kept the existing green route, yellow vehicle marker, HUD, routing, search, and 3D scene behavior unchanged.
- No CARTO or Streept map API key is required by this change.

## Verification
- Confirmed the source no longer references `tile.openstreetmap.org` or CARTO tile URLs.
- Confirmed the Leaflet map now renders two layers: dark base + label/reference overlay.
