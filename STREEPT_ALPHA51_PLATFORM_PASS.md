# Streept Alpha 51 — Navigation Core Performance

- Added a reusable route geometry index with cumulative distances and segment lengths.
- Live GPS matching now searches around the previously matched segment instead of rescanning long routes.
- Progress interpolation and route bearing use indexed/binary-search lookups.
- Full-route projection remains the safety fallback after a large jump.
- Added regression coverage for local matching.
