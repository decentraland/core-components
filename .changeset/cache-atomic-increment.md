---
'@dcl/core-commons': minor
'@dcl/redis-component': minor
'@dcl/memory-cache-component': minor
---

Add `increment(key, { amount, ttlInSeconds })` to `ICacheStorageComponent`: an atomic counter that returns the post-increment `value` and the counter's `ttlRemainingInMilliseconds`. The TTL is applied only when the counter is created (or when an existing counter has no expiry), so a fixed window never slides. The Redis implementation runs the whole operation as a single Lua `EVAL` (`INCRBY` + `PTTL` + conditional `PEXPIRE`); the in-memory implementation performs the read-modify-write in one synchronous block and uses lru-cache's `noUpdateTTL` to anchor the expiry to creation. A non-positive `ttlInSeconds` is rejected in both, since `PEXPIRE key 0` deletes the key in Redis while lru-cache reads a per-call `ttl: 0` as "never expire".

This is what makes counting workloads (rate limiting, quotas) correct on a shared store: `get` + `set` loses updates across a network round trip, and `acquireLock` costs several extra round trips per call.

**Breaking for anyone who _implements_ `ICacheStorageComponent`**, including `jest.Mocked<...>` object literals in tests: `increment` is a required member. Add `increment: jest.fn().mockResolvedValue({ value: 1 })` to existing mocks. Consumers of the interface are unaffected.

Two caveats now documented on the interface and in both READMEs: in-memory counters are subject to LRU eviction and can reset before their TTL expires, where Redis counters cannot; and the Redis backend lowercases every key while the in-memory backend does not, so normalize keys yourself when case-stability matters.
