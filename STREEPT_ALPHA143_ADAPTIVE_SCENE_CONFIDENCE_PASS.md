# Streept Alpha 143 — Adaptive Scene Confidence

Alpha 143 makes immersive guidance confidence-aware. Existing lane-match, connector/topology, GPS proximity, and scene-coverage signals are fused by a renderer-neutral confidence model. The 3D renderer uses that score to reduce the visual authority of uncertain lane and branch claims instead of presenting them as equally reliable.

## Behavior
- High-confidence lane/topology/GPS alignment keeps the selected lane and branch strong.
- Weak lane matching or missing topology lowers branch and lane emphasis.
- Missing scene context uses a conservative fallback rather than pretending the world model is complete.
- Confidence changes opacity/emphasis, not route correctness: the navigation engine remains the source of truth.
- Existing adaptive render-quality, streaming, junction choreography, traffic, infrastructure, and billboard lifecycles remain intact.

## Validation
- Recursive TypeScript/TSX transpilation check: 0 diagnostics (excluding `vite-env.d.ts`, an ambient declaration file).
- Full dependency-backed `tsc`/Vite build was not claimed because project dependencies are not installed in the validation environment.
