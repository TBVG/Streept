# Streept Pass 43 — Longitudinal Lane-Change Traffic Gaps

Implemented a stronger lane-change traffic gate. Target-lane vehicle observations are now projected along the physical lane-change trajectory, so safety considers the vehicle's longitudinal position relative to the merge point instead of relying only on 2-D distance.

## Changes
- Added trajectory projection with along-path distance.
- Exposes `gapAheadMeters` and `gapBehindMeters`.
- Blocks a fresh target-lane vehicle when it occupies the critical longitudinal merge gap.
- Keeps stale/low-confidence observations non-authoritative.
- Preserves closed-lane and accident/construction report handling.
- Added regression coverage for longitudinal gap behavior.

No paid services or APIs were added.
