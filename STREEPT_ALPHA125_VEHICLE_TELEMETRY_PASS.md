# Streept Alpha 125 — Provider-Neutral Vehicle Telemetry

## Delivered

- Added a backend `TrafficVehicle` contract containing location, OSM way/segment identity, optional lane index, speed, heading, observation time, confidence, and provider source.
- Added TTL-bounded in-memory vehicle storage and a geo-filtered `/api/traffic/vehicles` resync endpoint.
- Added `traffic_vehicle_updated` and `traffic_vehicle_removed` WebSocket events with the same 1 km server-side geo filtering used by existing live traffic events.
- Added client-side vehicle convergence alongside the existing incident/report stream, including out-of-order protection and 20-second freshness pruning.
- Added a conservative adapter into the existing lane-change safety model. Vehicles without lane identity are retained as telemetry but cannot be mistaken for occupancy of a specific target lane.

## Important boundary

Alpha 125 does **not** fabricate traffic. The backend store remains empty until a real telemetry adapter calls the provider ingestion entry point. This establishes the production contract and safety plumbing without pretending that replay/synthetic vehicles are live road traffic.

## Validation

- Frontend TypeScript/TSX syntax validation: expected to cover the new telemetry modules with the existing project-wide transpile pass.
- Backend Rust compilation is not available in this execution environment; Docker/Cargo remains the authoritative backend build path.
