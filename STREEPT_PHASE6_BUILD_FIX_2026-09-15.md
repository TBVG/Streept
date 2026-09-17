# Streept Phase 6 Build Fix — 2026-09-15

## User-side Docker build diagnosis

The uploaded Docker output shows the first frontend build attempt failed during `npm install` with `ECONNRESET`. The second attempt successfully completed dependency installation and reached the actual TypeScript build, so the remaining failure was source-code type checking rather than Docker/npm networking.

## Fixes applied

### `frontend/src/components/ImmersiveTurnView.tsx`
- Moved billboard-safety calculation into `renderScene`, where it is actually used to build the billboard lifecycle key.
- Passed `navigationSnapshot` and `remainingMeters` into `renderScene` so renderer code can use the navigation-engine snapshot instead of referencing an out-of-scope component variable.
- Passed the snapshot through to lane-guidance rendering.
- Removed the unused `idx` callback parameter reported by TypeScript.

### `frontend/src/components/NavigationView.tsx`
- Split the WebSocket event switch into explicit discriminated-union cases for `report_created`, `report_updated`, and `report_removed`.
- This prevents TypeScript from reading `report`, `parking`, `car`, or `id` from the wrong `WsEvent` variant while preserving the existing state updates.
- Removed the unused `idx` parameter from the route decision fallback map.

## Validation

The user's second Docker build got through `npm install` and failed only at `npm run build` with the listed TypeScript errors. The fixes above directly address every TypeScript error shown in that log.

A Docker build cannot be executed in this environment because the Docker CLI/daemon is unavailable here. The next local build should therefore be used as the final environment-level validation.
