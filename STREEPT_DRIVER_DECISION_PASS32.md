# Streept Pass 32 — Unified Driver Decision Layer

Added a renderer-independent canonical driver decision layer.

It resolves, in order:
1. verified prohibited route restrictions -> reroute
2. observed critical hazards -> high alert
3. route reacquisition / weak spatial confidence -> uncertain
4. actionable lane misalignment -> lane change
5. spatial speed / maneuver guidance -> slow, high-alert, prepare, or continue

The engine snapshot now exposes `driverDecision` so UI, voice, immersive rendering, replay, and future telemetry can consume the same policy output instead of independently re-deciding what the driver should do.

No external service or paid dependency was added.
