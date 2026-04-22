---
"@dcl/pg-component": minor
---

Review fixes and configuration improvements:

- Preserve the original transaction error when `ROLLBACK` itself fails in `withTransaction` / `withAsyncContextTransaction`, and release the broken client with `client.release(rollbackError)` so `pg` discards it instead of reusing it.
- Attach a `pool.on('error')` handler so idle-client errors are logged instead of bubbling up as unhandled Node errors; remove it on `stop()`.
- Attach a `client.on('error')` handler for the dedicated stream-query client for the same reason.
- Bound `stop()` with a new `PG_COMPONENT_STOP_TIMEOUT` env var (default 30s) so a stuck query can't block shutdown forever; the drain loop no longer busy-spins when `totalCount` is zero.
- `streamQuery` no longer clobbers `query_timeout` with `undefined` when `PG_COMPONENT_STREAM_QUERY_TIMEOUT` is unset; it now falls back to `PG_COMPONENT_QUERY_TIMEOUT`.
- New `PG_COMPONENT_CONNECTION_TIMEOUT` env var wired into `connectionTimeoutMillis` so `pool.connect()` can't hang forever if the DB is unreachable.
- `PG_COMPONENT_GRACE_PERIODS` fallback now uses `??` instead of `||`, so setting it to `0` actually disables draining.
- `start()` is now idempotent (guarded by a flag) and logs structured errors.
- Unified `query` / `measuredQuery` / `defaultQuery` into a single `query` function, removing a non-null assertion on `components.metrics`.
- Added `durationQueryNameLabel` to the `string` overload of `query` for parity with the `SQLStatement` overload.
- Documented in JSDoc and README that concurrent queries inside `withAsyncContextTransaction` are unsafe.
