# Streept Intersection Intelligence — Pass 38

## What changed

Pass 38 connects the navigation engine's junction intelligence directly to the immersive 3D renderer.

### 3D junction treatment
- Complex junctions are now promoted from engine state into the immersive lane renderer.
- The renderer uses the engine's `intersectionIntelligence` as the authoritative complexity signal.
- Complex approaches get stronger predictive branch emphasis while ordinary turns remain quiet.
- During the engine-defined preparation window, the 3D scene displays a compact junction label such as `ROUNDABOUT ENTRY`, `MERGE`, or `RAMP EXIT`.
- Existing physical lane connectors remain the selected-path geometry; no synthetic route is introduced.

### Intelligence pipeline correction
- Maneuver outcomes are recorded before road-intelligence scoring.
- A newly completed or missed maneuver therefore influences adaptive guidance immediately on the same engine refresh.
- Spatial reports passed into hazard intelligence now preserve their real report type/confidence instead of being relabeled generically.

## Safety / truthfulness
The 3D renderer may fall back to its existing maneuver classifier when engine state is unavailable, but it does not upgrade a junction beyond the engine's established complex/simple state. No geographic facts are invented.
