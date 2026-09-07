# Streept Alpha 136 — Immersive Roadside Billboard Objects

## Completed
- Added billboard objects to the Cesium immersive scene using the same live billboard inventory already visible in the 2D map.
- Rendered billboards as vertical physical roadside surfaces with support poles rather than floating UI markers.
- Live beta creatives are rendered directly on the physical billboard when an ad image is active.
- Empty inventory renders as an `AD SPACE` object; active creatives render as `LIVE AD` geometry.
- Billboard orientation is derived from the nearest mapped road so the object remains stable in the world as the camera moves.
- Billboard visibility participates in the existing forward-facing scene LOD system.
- Billboard scene lifecycle invalidates when creative/availability data changes.
- Only the nearest active scene chunk owns billboard rendering to avoid duplicate physical objects across overlapping chunks.

## Product boundary
This is a free testing/showcase capability. No payments, billing, advertiser accounts, or commercial checkout were added.
