# Streept Alpha 77 — Production Scene Delivery Pass

## Goal
Reduce runtime dependence on dynamic scene queries by making pre-generated scene tiles directly consumable from an object store/CDN while retaining the backend tile endpoint and development fallback.

## Completed
- Added a shared deterministic Web-Mercator scene tile address helper.
- Added optional `VITE_SCENE_TILE_URL` template support using `{z}`, `{x}`, and `{y}` placeholders.
- Immersive scene loading now follows: memory cache -> IndexedDB -> CDN/object-store tile -> Streept API tile -> dynamic `/scene-context` fallback.
- CDN payloads may be raw `SceneContext` JSON or the existing `{ success, data }` envelope.
- Kept tile fetching opportunistic and bounded so a CDN outage does not break navigation.
- Added deterministic tile-address tests.

## Deployment contract
Set `VITE_SCENE_TILE_URL` to an immutable/static tile template such as a CDN-backed `/scene/{z}/{x}/{y}.json`. The actual storage provider is intentionally not coupled to the frontend.

## Validation
- Changed TypeScript sources passed transpile/syntax validation.
- ZIP integrity verified.
- Full npm build and Rust compilation remain environment-limited when dependencies/toolchains are absent.
