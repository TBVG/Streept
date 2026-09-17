# Streept Pass 40 — Junction Guidance State

Added a renderer-independent junction guidance state machine for the immersive navigation view.

- Separates far / prepare / commit / inside phases.
- Uses the navigation engine's intersection and lane intelligence as inputs.
- Makes lane commitment explicit near complex junctions.
- Never recommends changing lanes inside a junction when the engine says it is not allowed.
- Adds focused Vitest coverage for phase transitions.
- Keeps the feature free of external APIs and keys.
