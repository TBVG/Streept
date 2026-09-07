# Streept Alpha 67 — GPS Continuity Pass

## Completed
- Added bounded short-horizon dead-reckoning for active navigation.
- Brief GPS gaps (3–15 seconds) extrapolate from the last trusted position, speed, and heading.
- Predicted points are fed through the existing route matcher so route progress and maneuver tracking can continue through short tunnel/urban-canyon gaps.
- Confidence decays as the outage grows; after 15 seconds the estimate expires and GPS is reported lost.
- Predicted accuracy is widened so extrapolated positions are not treated as fresh GPS observations.

## Validation
Changed TypeScript files were syntax-checked with the available TypeScript compiler. Full dependency installation/build remains environment-dependent and was not claimed as successful.
