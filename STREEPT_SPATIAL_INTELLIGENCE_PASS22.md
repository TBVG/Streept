# Streept Spatial Intelligence — Pass 22

This pass starts turning Streept's existing navigation systems into one reusable understanding of the driver's physical context.

## Added
- `frontend/src/navigation/spatialIntelligence.ts`
  - road classification from OSM highway tags
  - current road name / OSM way identity
  - lane count and one-way state
  - speed-limit parsing (including mph → km/h)
  - maneuver classification (turn, merge, roundabout, fork, ramp, complex)
  - nearby signals, crossings, and transit stops
  - nearby community-report count
  - evidence-based confidence score
- `NavigationEngine.snapshot()` now exposes `spatialIntelligence` so UI/renderers can consume one consistent context object.
- Spatial context refreshes when routes, scene evidence, or accepted/continuity GPS positions change.
- Unit coverage added in `spatialIntelligence.test.ts`.

## Design rule
The engine never invents road facts when scene evidence is unavailable. Unknown values remain unknown.

## Validation
The isolated environment does not contain the project's installed npm dependencies, so the full React/Vite test suite cannot be executed here. A global TypeScript check was attempted and is blocked by missing project dependencies (`react`, `vitest`, etc.), consistent with the existing environment limitation.
