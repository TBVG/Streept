# Streept Pass 31 — Spatial Hazard Intelligence

Streept's canonical spatial context now converts observed road reports into a conservative hazard signal.

## Added
- `spatialHazardIntelligence.ts`
- Critical classification for observed accidents, hazards, and closed lanes.
- Elevated classification for observed traffic jams.
- Closed-lane count and confidence are preserved for downstream guidance.
- Spatial guidance now lets observed critical hazards outrank generic speed and maneuver cues.
- Lane-change preparation is exposed as an elevated spatial cue when current lane alignment is known.
- Guidance stability no longer lets low-confidence `uncertain` state outrank a real critical alert.
- Added focused unit coverage.

## Safety boundary
This layer only consumes road intelligence already present in the session. It does not infer an accident, closure, traffic jam, or speed restriction from traffic density alone.
