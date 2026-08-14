---
'@dcl/core-commons': minor
'@dcl/redis-component': minor
'@dcl/memory-cache-component': minor
---

Add `increment(key, { amount, ttlInSeconds })` to `ICacheStorageComponent`: an atomic counter that returns the post-increment `value` and the counter's `ttlRemainingInMilliseconds`. The TTL is applied only when the counter is created, or when an existing counter has no expiry at all, so a fixed window never slides. The Redis implementation runs the whole operation as a single Lua script (`INCRBY` + `PTTL` + conditional `PEXPIRE`); the in-memory implementation performs the read-modify-write in one synchronous block and uses lru-cache's `noUpdateTTL` to anchor the expiry to creation. A non-positive `ttlInSeconds` is rejected in both, since `PEXPIRE key 0` deletes the key in Redis while lru-cache reads a per-call `ttl: 0` as "never expire".

This is what makes counting workloads (rate limiting, quotas) correct on a shared store: `get` + `set` loses updates across a network round trip, and `acquireLock` costs several extra round trips per call.

Redis invokes its Lua scripts (`increment` and `releaseLock`) with `EVALSHA` rather than `EVAL`, so a per-request workload sends a 40-byte digest instead of re-uploading the script body every call. A `NOSCRIPT` reply falls back to sending the body, which keeps it correct across a restart, failover or `SCRIPT FLUSH` as well as on a cold cache.

All logging in `@dcl/redis-component` moved to **debug** level. Every operation rethrows what it caught, so the caller owns the severity and the context; logging at error here as well double-reported the same failure.

## Note for anyone mocking the interface

This is an additive minor. Consuming code that *calls* `ICacheStorageComponent` needs no change.

The one place it is felt is a test double that reimplements the entire interface — `jest.Mocked<ICacheStorageComponent>` and hand-written object literals — which is tighter coupling to the interface shape than a consumer actually needs. Those see `TS2741` whenever they next widen their range, and the fix is one line:

```ts
increment: jest.fn().mockResolvedValue({ value: 1 })
```

Nothing moves on its own: every known consumer depends on `^0.10.1`, and a caret range on a `0.x` version locks the minor, so a repo picks this up only when it deliberately bumps.

## Two behaviours worth knowing

- In-memory counters are subject to LRU eviction and can reset before their TTL expires (`max` defaults to 10 000), where Redis counters cannot.
- The Redis backend lowercases keys in its string and counter operations while the in-memory backend does not, so normalize keys yourself when case-stability matters. Both are documented on the interface and in the two READMEs.
