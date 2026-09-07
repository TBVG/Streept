# Streept Alpha 56 — Platform Pass

This release consolidates navigation persistence and reliability into the client platform.

## Delivered
- Persistent active-navigation session snapshot in localStorage with validation and 12-hour expiry.
- Refresh/reload recovery for an active navigation session, including destination, route candidates, selected route and maneuver progress.
- Explicit clearing of persisted navigation when the user changes the planned start/destination or stops/finishes navigation.
- Heartbeat/touch updates keep a live session fresh without re-writing full route payloads every minute.
- The existing route cache, GPS gating, indexed matching, maneuver intelligence, predictive scene prefetch and offline shell remain intact.

## Why this matters
A serious navigation app must be resilient to browser refreshes and transient UI lifecycle events. The persistence layer is intentionally client-only and bounded; it does not create a server-side location history.

## Reliability hardening
- Same-origin API default for deployed HTTPS environments, avoiding accidental mixed-content calls when no explicit VITE_API_URL is supplied.
- Automatic retry for direct OSRM, Photon and scene-context network calls.
- Per-request anonymous client request IDs for diagnostics without introducing account requirements.
- Service worker upgraded to network-first document loading and runtime static-asset caching.
- GPS status surface now communicates live/offline/weak/lost states consistently.
