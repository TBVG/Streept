# Streept Pass 41 — Lane Execution Hardening

## Change
Lane-change execution now rejects implausible multi-lane jumps from a single GPS/lane-match fix.

## Behavior
- Adjacent-lane progress is accepted normally.
- A jump directly from lane 1 to lane 3 is treated as uncertain rather than completed.
- The target lane must be reached through physically plausible adjacent-lane observations.
- Existing confidence, reachability, traffic, and dynamics gates remain authoritative.

## Why
This prevents GPS noise or lane-matcher errors from falsely telling the driver that a multi-lane maneuver has already been completed.
