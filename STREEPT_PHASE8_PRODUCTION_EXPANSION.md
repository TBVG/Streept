# Streept Phase 8 — Non-Apple Production Expansion

This pass completes the remaining **application-side** expansion work without adding Apple-specific integrations.

## Delivered

### Self-hostable routing
- Backend routing now supports an ordered primary + fallback OSRM provider chain.
- Docker Compose includes an optional `routing` profile for a self-hosted OSRM MLD service.
- `scripts/prepare-osrm.sh` and `scripts/prepare-osrm.ps1` build a regional OSRM dataset from an OSM PBF.
- The default stack remains lightweight and continues using the configured public provider until a regional dataset is installed.

### Offline navigation
- Existing local route/session persistence remains the authoritative offline route fallback.
- Route planning now opportunistically prefetches a bounded map corridor into the browser Cache API.
- The service worker serves cached Esri dark-map tiles during network loss and revalidates them when online.
- Live traffic is never treated as offline truth.

### Spatial world-data scale
- Existing server-side scene-tile loading is retained.
- Added `scripts/split-scene-tiles.py` to shard a large SceneTile export by Web-Mercator address for CDN/object-store deployment.

### Privacy-preserving learning
- Spatial observations remain coarse and local-first; raw GPS traces, photos, accounts and identifiers are not added to the learning ledger.
- The existing server ledger is idempotent and retention-bounded.
- Added a small on-device online learner that consumes only coarse local observations and contributes a confidence-bounded signal to predictive spatial memory.

### Provider-neutral real-time data
- Existing vehicle ingestion remains provider-neutral and authenticated.
- Routing provider fallback is now explicit, making a Streept-owned routing stack replaceable without changing navigation clients.

## Deliberate boundaries

Some capabilities require external operational inputs and cannot be truthfully manufactured inside a source ZIP:

- A real fleet-traffic provider must supply real vehicle observations.
- A regional offline routing graph requires an actual OSM PBF and preprocessing.
- Large-scale 3D coverage requires actual OSM/building/terrain datasets and CDN/object storage.
- A production ML model requires real training data, evaluation, model governance and deployment infrastructure.

The project therefore provides the executable seams, local fallback behavior, data contracts, and preparation tooling for those capabilities rather than pretending those external assets already exist.

## Validation

- Repository source tree and ZIP were integrity checked.
- No Apple/CarPlay/native ecosystem integration was added in this phase.
- Full Docker/Vite/Rust dependency-backed builds still need to be run in the user's Windows/Docker environment.
