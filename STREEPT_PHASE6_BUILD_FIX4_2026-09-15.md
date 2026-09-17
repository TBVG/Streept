# Streept Phase 6 Build Fix 4 — Backend Rust compilation

## Failure fixed
The Docker build reached the Rust backend compilation stage. The frontend image built successfully, while Rust failed with three `E0689` errors because `sqlx::Row::try_get` left the floating-point type ambiguous before `.clamp()` was called.

## Changes
- Explicitly typed `avg_confidence` reads as `f64` and clamp bounds as `f64` at all three affected locations in `backend/src/handlers.rs`.
- Fixed `get_reports` to bind the already-clamped `radius` value instead of the raw request radius. This also removes the unused-variable warning and makes the intended 50–5000 m safety bound effective.
- Marked the unused offline-plan state extractor as `_state` to remove the compiler warning without changing handler behavior.

## Expected result
The previous three Rust `E0689` compilation errors should be gone. The build should proceed to the remaining Rust compilation/linking stages.

Full Docker build was not run in this environment.
