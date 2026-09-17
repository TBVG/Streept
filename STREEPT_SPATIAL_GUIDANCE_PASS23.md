# Streept Spatial Guidance — Pass 23

Pass 23 turns the spatial context from Pass 22 into a conservative driver-facing decision.

## Added
- `frontend/src/navigation/spatialGuidanceDecision.ts`
- Spatial guidance decisions: continue, prepare, slow, high-alert, uncertain.
- Known speed limits can produce a slowdown target; no speed target is invented when the limit is unknown.
- Complex/roundabout/fork/ramp maneuvers receive higher priority when close.
- Low spatial confidence explicitly produces an uncertain state.
- `NavigationEngine.snapshot()` now exposes `spatialGuidance` alongside `spatialIntelligence`.
- Unit coverage in `spatialGuidanceDecision.test.ts`.

## Next direction
The next pass can connect this decision to the existing driver-facing visual/voice guidance so Streept's map, 3D scene, and instructions respond consistently to the same spatial decision.
