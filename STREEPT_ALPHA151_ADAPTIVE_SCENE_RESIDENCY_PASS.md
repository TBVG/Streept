# Streept Alpha 151 — Adaptive Scene Residency & Long-Drive Stability

Alpha 151 bounds immersive scene residency across quality tiers and makes scene object identity deterministic. A framework-neutral residency planner ranks current/forward chunks using protection, predictive preference, proximity and recency, then explicitly evicts chunks outside the budget before new Cesium primitives are created. This limits long-drive memory growth and garbage-collection pressure while preserving the driver's current corridor.

Stable scene object identities prefer OSM IDs, then node IDs, then deterministic geometry signatures so overlapping scene bubbles can reason about the same physical object without relying on array position.

Validation: TypeScript/TSX syntax transpilation and focused unit tests; full dependency-backed build and Rust compilation remain environment-dependent.
