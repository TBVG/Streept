# Streept real-time provider contract

Streept does not fabricate fleet traffic. A provider must send authenticated observations to `POST /api/traffic/vehicles/ingest` using the existing contract.

Required fields per observation:
- stable provider vehicle identifier
- latitude/longitude
- observation timestamp
- confidence
- provider source

Optional fields:
- OSM way id
- lane index
- segment id
- speed
- heading

The backend validates bounds, limits batch size, orders observations by observation time, expires stale vehicles, and forwards accepted observations over the existing WebSocket stream.
