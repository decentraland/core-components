---
'@dcl/pg-component': major
---

Recover from database disconnections instead of failing the request. A failover, a restart, or a
service booting before its database no longer needs a process restart.

On a connection error the component now evicts the broken client so `pg` cannot hand the same dead
socket to the next caller and keeps a background loop probing the database with exponential backoff
and jitter until it answers — so the pool is warm again before the next request arrives. Operations
issued while the database is known to be down wait for that loop's verdict rather than retrying on
their own (a circuit breaker: one stream of probes instead of one per caller), and fail with a typed
`DatabaseUnavailableError` (driver error in `cause`, generic message) if it does not come back within
their budget — about three seconds by default. The pool object is never replaced, so a reference from `getPool()` survives an outage.
`start()` gets its own, larger budget (about thirty seconds) for the common case of the database
still booting.

Retries are limited to what is safe: acquiring a connection, and statements `pg` refused to send
because the client was already dead (the usual symptom of a restart behind a warm pool, and proof
that nothing reached the server). A connection that drops mid-statement is surfaced, since retrying
it would turn a write into an at-least-once operation; a statement whose replay is harmless can opt
in per call with `query(sql, { idempotent: true })` — the second argument of `query()` now takes an
options object as well as the metrics label.
Transactions are only retried before `BEGIN` succeeds, migrations only while connecting — both run
caller-provided code that a replay would repeat — and queries inside `withAsyncContextTransaction`
are never retried, since a fresh connection would silently escape the transaction.

The component now defaults `connectionTimeoutMillis` to 10s and enables TCP `keepAlive`: reconnection
only reacts to failures it can see, and a host that silently drops packets produces none without
them. Note that `pg` applies the connection timeout to the wait for a free client too, so a saturated
pool now fails callers after 10s instead of queueing them indefinitely — that failure is
deliberately not treated as a disconnection.

Also fixes two latent bugs on the same path. `pg-pool` removes its own `'error'` listener while a
client is checked out, so a socket dying mid-statement emitted an unhandled `'error'` event and took
the process down; the component now holds a listener for the duration of every checkout. And a
connection dying mid-`streamQuery` hung the iteration forever — destroying the stream makes
`pg-cursor` wait for a `readyForQuery` that can never arrive — so the iteration now races the
client's `'end'` event and rejects instead of blocking.

New `getConnectionStatus()` (cached, cheap enough for a readiness probe) and `ping()` (active
`SELECT 1`, rate-floored to one probe per initial backoff delay since each is a real connection), plus `onDisconnection` / `onReconnection` hooks, a `dcl_db_connection_status` gauge and
a `dcl_db_reconnection_attempts_total` counter. Everything is tunable through `PG_COMPONENT_RECONNECTION_*`
env vars or the new `reconnection` factory option, and `PG_COMPONENT_RECONNECTION_ENABLED=false`
restores the previous fail-fast behaviour. Probes use a short-lived connection of
their own, never a pooled checkout, so a saturated pool cannot be mistaken for an outage; each is
bounded by `PG_COMPONENT_RECONNECTION_PROBE_TIMEOUT` (default 5s), which also clamps that
connection's timeouts — a pool timeout disabled with `0` is replaced, not inherited — so `ping()`
reports an unhealthy database instead of hanging. The
`DatabaseUnavailableError` message is generic; the driver's error is in `cause`.

Released as a major because `IPgComponent` gains two required methods: real component instances are
unaffected, but anything that implements or mocks the interface structurally — a hand-built
`Mock<IPgComponent>` in a consumer's tests, for instance — stops type-checking until it adds
`getConnectionStatus()` and `ping()`.
