# STREEPT Alpha 139 — Junction Comprehension & Driver Cues

## Goal
Make complex junctions understandable before the driver reaches the decision point, while keeping ordinary turns quiet and the immersive scene uncluttered.

## Implemented
- Added framework-neutral `junctionCues.ts` with deterministic approach/decision/exit zone planning.
- Complex behaviors (roundabouts, merges, splits, ramps, U-turns) receive longer preparation/exit windows and stronger branch emphasis.
- Simple turns receive shorter, lower-emphasis cue zones.
- Integrated cue zones into the physical driver-first Cesium road geometry.
- Selected lane/junction branches remain visually dominant; complex junction alternatives are visible but muted.
- Existing lane arrows, roadside wayfinding, maneuver instruction, and physical lane surface remain the primary hierarchy rather than adding a separate screen HUD.
- Removed a stale undefined lane-change block from `addTurnGuidance`; lane-change geometry remains owned by the driver-first/lane-guidance lifecycle.
- Added deterministic tests for simple vs complex cue behavior.

## Validation
- Recursive TypeScript/TSX transpilation check: 0 diagnostics (excluding ambient `vite-env.d.ts`).
- ZIP integrity verified after packaging.
- Full TypeScript typecheck is not claimed because frontend dependencies are not installed in the execution environment.
