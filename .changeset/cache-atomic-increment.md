---
'@dcl/core-commons': minor
'@dcl/redis-component': minor
'@dcl/memory-cache-component': minor
---

Add `increment(key, { amount, ttlInSeconds })` to `ICacheStorageComponent`: an atomic counter that returns the post-increment `value` and the counter's `ttlRemainingInMilliseconds`. The TTL is applied only when the counter is created, or when an existing counter has no expiry at all, so a fixed window never slides. The Redis implementation runs the whole operation as a single Lua `EVAL` (`INCRBY` + `PTTL` + conditional `PEXPIRE`); the in-memory implementation performs the read-modify-write in one synchronous block and uses lru-cache's `noUpdateTTL` to anchor the expiry to creation. A non-positive `ttlInSeconds` is rejected in both, since `PEXPIRE key 0` deletes the key in Redis while lru-cache reads a per-call `ttl: 0` as "never expire".

This is what makes counting workloads (rate limiting, quotas) correct on a shared store: `get` + `set` loses updates across a network round trip, and `acquireLock` costs several extra round trips per call.

## Breaking change and migration

`increment` is a **required** member, so this breaks anyone who *implements* `ICacheStorageComponent` — in practice `jest.Mocked<...>` object literals and hand-written test doubles. Consumers who only *call* the interface are unaffected.

`@dcl/core-commons` is a `0.x` package, where the minor slot is the breaking channel under semver, so `0.10.1 → 0.11.0` is the correct and intended signal for this change.

**Nothing upgrades automatically.** Every known affected repo — `world-storage-service`, `linker-server`, `marketplace-server`, `credits-server`, `worlds-content-server` — depends on `^0.10.1`, and a caret range on a `0.x` version locks the minor (`>=0.10.1 <0.11.0`). None of them can resolve to `0.11.0` without a deliberate range change, so no existing build breaks on release.

When a repo does move up, the compile error is `TS2739` (missing property `increment`) on each cache double, and the fix is one line per mock:

```ts
increment: jest.fn().mockResolvedValue({ value: 1 })
```

Declaring it optional was considered and rejected: it would convert a compile-time guarantee into a runtime failure, and a rate limiter whose counter silently no-ops is the worst available failure mode.

## Two behaviours worth knowing

- In-memory counters are subject to LRU eviction and can reset before their TTL expires (`max` defaults to 10 000), where Redis counters cannot.
- The Redis backend lowercases every key while the in-memory backend does not, so normalize keys yourself when case-stability matters. Both are now documented on the interface and in the two READMEs.
