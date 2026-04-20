---
'@dcl/redis-component': major
---

Fix `acquireLock` using `EX` (seconds) for a value in milliseconds — the default 10-second lock was actually being set to 10 000 seconds (~2.7 hours). Now uses `PX` so the unit matches the `ttlInMilliseconds` option.

**Breaking** — all methods now preserve the key's original case instead of silently lower-casing it. Mixed-case keys written before this version will remain under their old lower-cased names in Redis; callers that relied on case-insensitive lookups must either continue lower-casing at the call site or migrate their data.

Alongside these: `set` no longer passes `{ EX: undefined }` when no TTL is given, the redundant `await` on the synchronous `client.multi()` is removed, error logs are unified around the structured `{ error }` pattern, and the test suite is updated accordingly (including the mock now exposing `close` instead of the unused `quit`).
