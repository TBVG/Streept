# Streept Phase 6 — Build Fix 5 (Backend readiness)

## Root cause fixed
The backend `/ready` endpoint executed:

`sqlx::query_scalar::<_, i64>("SELECT 1")`

PostgreSQL's uncast integer literal `1` is an `INT4` value, while the Rust/SQLx query requested an `i64` (`BIGINT`). The database connection and migrations could therefore succeed while the readiness query failed and returned HTTP 503.

The query is now:

`sqlx::query_scalar::<_, i64>("SELECT 1::BIGINT")`

This makes the PostgreSQL result type explicitly `BIGINT`, matching `i64`.

## Expected runtime result
- `/health` remains HTTP 200.
- `/ready` should become HTTP 200 with `{ "status": "ready", "database": "ok" }` once the backend starts.
- Docker should mark the backend healthy.
- Because the frontend depends on backend health, Compose should then start the frontend automatically.

## Validation performed
- Confirmed the readiness handler was the only `/ready` implementation.
- Confirmed the fix changes only the SQL result type and does not alter application behavior.
- ZIP integrity verified after packaging.

## Note
The prior Rust compile errors were already fixed in Build Fix 4. This pass addresses the separate runtime readiness failure discovered after the successful Rust build.
