# Streept Search + POI Intelligence Pass

This pass improves search behavior without committing Streept to a final visual design.

## What changed

- Added intent-aware search for coffee, food, fuel, parking, EV charging, hotels, shopping, pharmacies, hospitals and attractions.
- Strips driver language such as `near me`, `on my route`, `cheap`, `best`, and `don't detour` before provider search.
- Adds route-aware search sampling so category searches can look ahead along the active route instead of only around the driver's current GPS fix.
- Ranks returned places using text relevance, proximity, route proximity and destination proximity.
- Labels results as nearby, on-route, or destination-context and provides a conservative route-proximity/detour hint.
- Adds quick-search category actions and a dedicated "find something on my route" action to the existing search surface.
- Extends Photon/OpenStreetMap geocoder results with optional POI classification (`category`, `type`) for richer future POI cards.
- Keeps the existing public, zero-cost provider strategy and existing fallback behavior.

## Deliberate limitation

The current route/detour labels are spatial-proximity hints, not exact additional driving time. Exact detour time should be backed by a dedicated route-to-POI calculation before being presented as a precise number.
