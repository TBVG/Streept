# Streept Production Hardening Pass

## Completed

### Backend source hygiene
- Removed the duplicated second copy of the parking, report, billboard, offline-plan, and route handlers in `backend/src/handlers.rs`.
- Kept the first, canonical handler implementations and all current route registrations intact.
- This eliminates duplicate Rust symbol definitions and prevents fixes from diverging between two copies of the same API.

### Production frontend container
- Replaced the Vite development server in the frontend container with a multi-stage production build.
- Frontend assets are built once and served by nginx.
- SPA history fallback is enabled.
- Static assets receive long-lived cache headers.
- `/api/*` is reverse-proxied to the backend container.
- `/ws` is reverse-proxied with WebSocket upgrade headers.
- API/WS URLs default to same-origin paths, while Docker build args allow deployment-specific overrides.

### Documentation alignment
- README status now describes the current production-hardening phase rather than an old Alpha number.
- Removed the claim that `backend/openapi.yaml` is the source of truth while it still described removed reservation APIs.
- Documented the actual endpoint surface and production-container behavior.

## Validation
- Backend duplicate handler marker count: 1.
- Frontend TypeScript/TSX transpile validation: run after edits.
- Dockerfile/nginx/compose configuration inspected for production path consistency.
- Full Docker build and Rust compilation remain environment-dependent and are not claimed unless executed on a Docker-enabled host.
