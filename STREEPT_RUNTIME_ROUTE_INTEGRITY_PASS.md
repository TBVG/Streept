# STREEPT Runtime Route Integrity Pass

## Problems observed in manual testing

- The trip-preview primary action could overflow its card because the button had `width: 100%` while also living beside a secondary action in a flex row.
- The backend could return a fabricated fallback route when OSRM was unreachable. That geometry is not road-aware and can render a straight/L-shaped line across the map.
- Old browser route/session caches could preserve fabricated geometry after the routing behavior was corrected.

## Changes

1. The backend no longer treats fabricated geometry as a valid navigation route. OSRM failures now return `502 Bad Gateway`, allowing the browser's direct OSRM fallback to run.
2. The frontend route cache key was bumped from `v2` to `v3`.
3. Active navigation persistence was bumped from `v1` to `v2`, preventing stale sessions from restoring prior route state.
4. The preview action row now constrains the primary button as a flex item so it stays completely inside the card.

## Product rule

A route that is not backed by real routing geometry must never be presented as a drivable route. If all real routing providers fail, Streept should show an unavailable/retry state rather than draw a fabricated path.
