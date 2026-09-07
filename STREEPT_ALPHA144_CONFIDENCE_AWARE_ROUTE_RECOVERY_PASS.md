# Streept Alpha 144 — Confidence-Aware Route Recovery

## Goal
Keep immersive navigation continuous when GPS/lane matching or scene data becomes unreliable, while making the source of uncertainty visually honest.

## Completed
- Added renderer-neutral `sceneRecovery` state model.
- Distinguishes lane/GPS uncertainty from stale scene data.
- Preserves a reduced physical guidance path during recovery instead of removing navigation cues.
- Adds a restrained recovery line in the immediate driver field.
- Scene cache timestamps distinguish freshly fetched context from stale context.
- Recovery strength remains reversible as confidence returns.
- Added deterministic tests for stable, lane-uncertain, stale-scene, and reacquiring states.

## Design rule
Recovery changes visual authority, never the navigation decision itself. The driver-first road hierarchy remains intact.
