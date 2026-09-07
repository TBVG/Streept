# Streept Alpha 50 — ETA & GPS continuity pass

- Added a pure navigation ETA engine derived from actual route progress instead of displaying the original total trip time throughout the trip.
- ETA blends route baseline duration with live speed when a trustworthy speed estimate is available, with bounded outputs for slow/stopped GPS states.
- Active navigation cockpit now shows remaining minutes plus a live arrival estimate.
- Added a stale-GPS watchdog: during active navigation a missing location update for more than 9 seconds is surfaced as GPS lost instead of leaving a misleading GPS-locked indicator forever.
- Added regression tests for live-speed ETA and stopped-vehicle ETA behavior.
