# Streept Alpha 153 — Renderer Object Pooling Pass

- Reuse bounded Cesium `PrimitiveCollection` containers during scene-bubble handoffs.
- Explicitly clear pooled collections before reuse to prevent stale child geometry.
- Return retired/evicted scene containers to the pool instead of allocating a new container each time.
- Keep the pool bounded (8 containers) so pooling cannot become a long-drive memory leak.
- Add deterministic tests for reuse, bounded retention, and pool clearing.

This reduces renderer/container allocation churn while preserving the existing residency and cross-bubble identity policies.
