# Streept Alpha 53 — Spatial Performance + Offline Continuity Pass

## Navigation reliability
- Extended route cache lifetime to 24 hours for transient-network resilience.
- Increased cache capacity to 24 recent routes.
- Added a geographically-constrained nearest cached-route fallback when both the Streept backend and direct OSRM are unreachable.
- Cached routes retain their origin/destination metadata for safe fallback validation.

## Immersive scene performance
- OSM building geometry is now compiled into a single Cesium primitive rather than hundreds/thousands of independent polygon entities.
- Increased nearby building coverage while reducing entity overhead.
- Preserved detailed road/lane/sign/crossing overlays and real OSM-derived heights.
- Route-following first-person camera now derives heading from forward route geometry, producing more natural views on curves.

## Product direction
- This pass prioritizes the two characteristics that matter most for a premium navigation product: uninterrupted navigation and high-detail spatial rendering without proportional CPU/GPU overhead.

## Validation
- The project was statically inspected after changes.
- Full dependency installation/build could not be completed in this environment because external npm package installation timed out.
