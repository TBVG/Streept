# Streept Alpha 127 — Cesium Live Traffic Layer

## Implemented
- Added a framework-neutral `buildLiveTraffic3D` pipeline for fresh, confidence-filtered traffic vehicles.
- Culls vehicles to a bounded 350 m driver-perspective horizon and caps rendering at 120 candidates.
- Preserves provider GPS coordinates when lane identity is unavailable.
- When `way_id` + `lane_index` match live OSM scene geometry, projects the vehicle onto the physical lane centerline instead of inventing a lane.
- Uses provider heading when present and derives a heading from physical lane geometry only when safe.
- Added stable Cesium entities for live vehicles so telemetry updates do not recreate the whole scene.
- Stale/low-confidence/out-of-range vehicles are removed from the rendered layer.
- Wired `NavigationView` vehicle telemetry into the existing `ImmersiveTurnView`; no second Cesium viewer was introduced.
- Added regression tests for freshness, confidence filtering, physical lane snapping, and render caps.

## Safety boundary
The visual traffic layer is presentation-only. Lane-change safety and maneuver decision logic remain authoritative; rendering never mutates navigation decisions.

## Remaining provider work
The generic authenticated `/traffic/vehicles/ingest` endpoint is ready from Alpha 126, but no external telemetry provider is bundled. Real vehicles appear once provider telemetry is posted to that endpoint.
