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
- The test double exposes `close` instead of the unused `quit`, gains an `isOpen` state, and the previously-uncovered start/stop/parse-error paths now have tests.
