# Streept Alpha 148 — Scene Freshness & Recovery Continuity

## Goal
Make streamed 3D scene freshness explicit and deterministic so cached world context can age gracefully and refresh without breaking route continuity.

## Changes
- Added `navigation/sceneFreshness.ts` with a framework-neutral freshness policy and tracker.
- Scenes are classified as `fresh`, `aging`, `stale`, or `unknown`.
- Aging/stale world detail is progressively subordinated while route continuity is retained.
- Scene timestamps are now tracked through an explicit `SceneFreshnessTracker` rather than an out-of-scope render closure.
- Provided/callback scene contexts receive a timestamp once, preventing repeated freshness resets.
- Stale cached maneuver scenes are invalidated and refetched on the next render lifecycle.
- Lifecycle keys include freshness state so the renderer can transition deterministically.
- Added deterministic freshness tests.

## Driver-safety principle
Freshness never removes the route. The system degrades surrounding world detail first, then reacquires scene context while keeping navigation continuity visible.
