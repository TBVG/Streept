# Streept Alpha 137 — Roadside World Reconstruction

## Completed
- Kept roads and buildings as the primary static world geometry while preserving the existing adaptive LOD system.
- Added lightweight physical roadside wayfinding/signage derived from available OSM destination, speed, and road-name metadata.
- Limited sign count and distance visibility to keep the driver-first view readable and performant.
- Preserved real lane markings, junction connectors, traffic signals, crossings, transit stops, street lamps, trees, and live billboard objects in the same streamed scene lifecycle.
- Fixed the live render path so billboard inventory is passed through every scene refresh, not only the initial render.

## Product direction
The immersive view is now explicitly treated as a coherent roadside world. Alpha 138 will shift the hierarchy toward the driver's visible road surface, physical lane paths, and upcoming junction geometry.
