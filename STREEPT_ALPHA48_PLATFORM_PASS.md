# Streept Alpha 48 — Driver-grade location and follow-mode pass

- Extracted GPS fix validation into a testable navigation-core function.
- Rejects temporally stale and implausible GPS jumps before they affect navigation.
- Preserves the last trustworthy position through transient geolocation failures.
- Added explicit GPS health feedback in the UI.
- Added navigation-app-style follow mode that keeps the driver centered while navigating.
- Manual map pan/zoom pauses follow mode; Locate restores it.
- Added regression tests for impossible jumps and high-speed plausible movement.
