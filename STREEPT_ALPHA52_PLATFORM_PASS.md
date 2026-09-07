# Streept Alpha 52 — Integrated Platform Pass

- Added a route-quality/risk scoring layer using active community reports near each route.
- Safer routes can outrank marginally faster but materially more hazardous alternatives.
- Added active-navigation road-alert visibility and trip-preview risk counts.
- Added persistent voice-guidance toggle; high-speed driving gets earlier spoken thresholds.
- Added a periodic hazard-refresh tick so the UI can re-evaluate active route risk without rebuilding the route every GPS frame.
- Preserved the existing navigation state machine, GPS matching, route caching and immersive-view architecture.

Validation note: package/dependency installation is environment-limited here; code-level strict TypeScript issues introduced/observed in this pass were corrected where source inspection identified them.
