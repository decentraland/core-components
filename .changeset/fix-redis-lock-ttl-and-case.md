---
'@dcl/redis-component': major
---

Fix `acquireLock` using `EX` (seconds) for a value in milliseconds — the default 10-second lock was actually being set to 10 000 seconds (~2.7 hours). Now uses `PX` so the unit matches the `ttlInMilliseconds` option.

**Breaking** — all methods now preserve the key's original case instead of silently lower-casing it. Mixed-case keys written before this version will remain under their old lower-cased names in Redis; callers that relied on case-insensitive lookups must either continue lower-casing at the call site or migrate their data.

Alongside these:

- `set` rejects an `undefined` value synchronously (mirrors the memory-cache guard); `JSON.stringify(undefined)` would otherwise reach the wire and error unpredictably. `setInHash` does the same.
- `set` no longer passes `{ EX: undefined }` when no TTL is given; the redundant `await` on the synchronous `client.multi()` is removed; error logs are unified around the structured `{ error, stack? }` payload so stack traces are preserved when available.
- `start()` is idempotent *and* concurrency-safe: two callers firing before the first `connect()` resolves are both funneled onto the same `startPromise`, so the second no longer races past the `isOpen` guard and crashes with "Socket already opened". `stop()` short-circuits when `isOpen` is false, avoiding "Socket is closed" on a double invocation.
- `get` / `getFromHash` check for `null`/`undefined` explicitly instead of a truthy check, so a malformed empty string surfaces to the caller as a parse error rather than silently returning `null`.
- `getAllHashFields` iterates field-by-field and surfaces the offending field name in the structured log before rethrowing, instead of losing all context to a single `JSON.parse` failure.
- `acquireLock` clamps a non-positive `ttlInMilliseconds` back to the default — the previous behavior forwarded `PX: 0`, which Redis rejects at the wire and the caller would only see as a `LockNotAcquiredError`.
- `acquireLock` retry uses equal-jitter backoff (sleep in `[retryDelay/2, retryDelay)`), with the full expression wrapped in `Math.floor` so the sleep is always an integer-millisecond value, not a fractional `50.5` for odd `retryDelay`.
- `releaseLock` uses `EVALSHA` with a cached SHA once `SCRIPT LOAD` succeeds, falling back to `EVAL` on the first call and on `NOSCRIPT` replies (e.g. after a server-side `SCRIPT FLUSH` or failover). A synchronous `scriptLoad` failure (older clients that do not expose the method) is also treated as a soft fallback.
- Connection URL is redacted before it reaches the debug log. Managed-Redis URLs of the shape `redis://user:password@host:port` previously wrote the password into `"Connecting to Redis"`.
- Connection lifecycle is now observable: `reconnecting`, `ready`, and `end` events are logged at debug level alongside the existing `error` handler, which now carries the stack trace as well.
- `setInHash` inspects the `multi().exec()` replies. Per-command errors (e.g. `WRONGTYPE`) were previously swallowed because the transaction resolved with per-command `Error` instances instead of throwing; now they surface to the caller.
- The test double exposes `close` instead of the unused `quit`, gains an `isOpen` state plus `evalSha` / `scriptLoad` mocks, and previously-uncovered start/stop/parse-error/jitter/lifecycle-event/transaction-error/EVALSHA-cache/concurrent-start/credential-redaction paths now have tests.
