# STREEPT Alpha 149 — Adaptive Scene Reacquisition & Bubble Handoff

## Goal
Make streamed 3D scene movement feel continuous when the driver crosses scene-bubble boundaries.

## Delivered
- Added framework-neutral `sceneReacquisition.ts`.
- Scene bubbles now have explicit `active`, `warming`, `handoff`, `retiring`, and `stale` policy states.
- Desired bubble count respects adaptive render-quality budgets.
- Nearest bubble is always the primary bubble.
- New bubbles are warmed before old non-desired bubbles are retired.
- Old bubbles receive a bounded overlap window (faster when movement is decisive).
- Stale active bubbles are replaced rather than silently retained.
- Billboard inventory remains restricted to the primary bubble, preventing duplicate roadside ads during overlap.
- Existing chunk primitives/entities are reused when possible.
- Added deterministic tests for budget limits, warming + handoff, stale reacquisition, and primary selection.

## Validation
- TypeScript/TSX syntax transpilation: validated with the repository's global TypeScript compiler, excluding the ambient `vite-env.d.ts` declaration file.
- Full dependency-backed `tsc` build was not claimed because `node_modules` is not shipped in the archive.
- Backend compilation was not claimed because Rust/Cargo is unavailable in the execution environment.
