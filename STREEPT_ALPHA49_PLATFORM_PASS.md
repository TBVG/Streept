# Streept Alpha 49 — Offline-first shell pass

- Added a production-style PWA manifest and installable application metadata.
- Added a service worker for the same-origin application shell so Streept can reopen offline instead of presenting a blank network error page.
- Keeps external map/search/routing services out of the service-worker cache to avoid violating their public caching policies.
- Added graceful service-worker registration failure handling.
- Preserves the existing cached-route/navigation continuity strategy underneath the offline shell.
