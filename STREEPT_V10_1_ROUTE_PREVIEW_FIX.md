# Streept v10.1 — Route Preview Reliability Fix

This pass fixes the two GitHub E2E failures observed in v9:

1. **Trip Preview / Enter navigation stuck disabled**
   - Duplicate route-preview requests for the same origin/destination are suppressed.
   - An already committed route remains usable while a replacement/background request is running.
   - The primary navigation action is no longer coupled to unrelated enrichment work.

2. **Trip Preview disappearing after route updates**
   - A later failed preview/reroute request no longer clears an already committed route.
   - Route request lifecycle state is keyed to the actual origin/destination pair.
   - Selecting a new destination or closing the preview resets the lifecycle cleanly.
   - Stale responses remain prevented by the existing request-id guard.

Validation performed in the build environment:
- Source brace-balance check passed.
- Global TypeScript parser reached the project sources without syntax/parse errors; full typecheck could not run because npm dependencies were unavailable.
- Full Playwright E2E was not run in this environment.
