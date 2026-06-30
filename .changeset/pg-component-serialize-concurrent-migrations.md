---
"@dcl/pg-component": patch
---

Serialize concurrent migrations instead of failing with "Another migration is already running".

node-pg-migrate guards migrations with a non-blocking advisory lock (`pg_try_advisory_lock`) and throws immediately when it loses the race. When several pg-components migrate the same database around the same time (e.g. multiple components started together on boot), the losers would fail outright — and a caller that does not fail fast (such as a components lifecycle) can hang on that error rather than surface it. `start()` now retries the migration with a short, jittered backoff while another migration holds the lock, so concurrent migrations serialize behind whichever one currently holds it.

The retry behavior is configurable via `PG_COMPONENT_MIGRATION_RETRY_ATTEMPTS` (default `30`) and `PG_COMPONENT_MIGRATION_RETRY_DELAY` in milliseconds (default `1000`).
