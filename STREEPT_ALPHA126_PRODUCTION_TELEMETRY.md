# Streept Alpha 126 — Production Vehicle Telemetry Ingestion

## Delivered

- Added authenticated `POST /traffic/vehicles/ingest` provider webhook.
- Added bounded batches (maximum 1000 observations/request).
- Validates coordinates, confidence, vehicle ID, and provider source.
- Reuses the existing vehicle store and WebSocket events so accepted telemetry immediately reaches nearby navigation clients.
- Added `VEHICLE_INGEST_TOKEN`; ingestion returns unavailable when no token is configured.

## Safety boundary

No vehicles are generated or simulated. A real telemetry provider must supply observations to the webhook.
