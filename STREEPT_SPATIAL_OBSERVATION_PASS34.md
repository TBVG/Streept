# Streept Pass 34 — Local Spatial Observation Ledger

Streept now keeps a bounded, local-first observation ledger for navigation outcomes.

## Captured
- maneuver completed / missed
- coarse OSM way id
- maneuver type
- lane alignment
- confidence
- route generation
- timestamp

## Deliberately excluded
- raw GPS traces
- account identifiers
- photos
- exact maneuver coordinates

The ledger is capped at 300 observations and remains best-effort so it can never interrupt navigation.

This establishes the local foundation for Streept's future road-intelligence learning loop without introducing a paid data service or silently uploading driver data.
