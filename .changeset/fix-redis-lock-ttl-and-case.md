---
'@dcl/redis-component': major
---

Fix `acquireLock` using `EX` (seconds) for a value in milliseconds — the default 10-second lock was actually being set to 10 000 seconds (~2.7 hours). Now uses `PX` so the unit matches the `ttlInMilliseconds` option.

**Breaking** — all methods now preserve the key's original case instead of silently lower-casing it. Mixed-case keys written before this version will remain under their old lower-cased names in Redis; callers that relied on case-insensitive lookups must either continue lower-casing at the call site or migrate their data.

Alongside these:

- `set` no longer passes `{ EX: undefined }` when no TTL is given; the redundant `await` on the synchronous `client.multi()` is removed; error logs are unified around the structured `{ error }` pattern.
- `start()` and `stop()` are now idempotent — `start()` short-circuits if the client is already open, `stop()` short-circuits if it is not, so neither can throw `"Socket already opened"` / `"Socket is closed"` on double invocation.
- `get` / `getFromHash` check for `null`/`undefined` explicitly instead of a truthy check, so a malformed empty string surfaces to the caller as a parse error rather than silently returning `null`.
- `getAllHashFields` iterates field-by-field and surfaces the offending field name in the structured log before rethrowing, instead of losing all context to a single `JSON.parse` failure.
- `acquireLock` clamps a non-positive `ttlInMilliseconds` back to the default — the previous behavior forwarded `PX: 0`, which Redis rejects at the wire and the caller would only see as a `LockNotAcquiredError`.
- `acquireLock` retry now uses equal-jitter backoff (sleep in `[retryDelay/2, retryDelay)`), matching the queue-consumer pattern, so concurrent consumers contending on the same key no longer phase-lock onto the same retry tick.
- Connection lifecycle is now observable: `reconnecting`, `ready`, and `end` events are logged at debug level alongside the existing `error` handler.
- `setInHash` inspects the `multi().exec()` replies. Per-command errors (e.g. `WRONGTYPE`) were previously swallowed because the transaction resolved with per-command `Error` instances instead of throwing; now they surface to the caller.
- The test double exposes `close` instead of the unused `quit`, gains an `isOpen` state, and the previously-uncovered start/stop/parse-error/jitter/lifecycle-event/transaction-error paths now have tests.
