# Streept Alpha 47 — Navigation Product Pass

- Added a driver-first active navigation cockpit HUD with upcoming maneuver, lane guidance, live speed, route progress, 2D/3D toggle, recenter, and stop controls.
- Improved route ranking so returned alternatives consider ETA, distance, maneuver count, and maneuver complexity.
- Added a bounded 30-minute local route cache (up to 10 recent routes) so recent trips can survive transient routing/network failures.
- Preserved active navigation state separation so the trip-preview CTA cannot reappear during an active reroute.
- Added responsive mobile styling for the cockpit and start actions.
