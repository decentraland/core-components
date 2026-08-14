# @dcl/memory-cache-component

## 2.5.0

### Minor Changes

- 6871695: Add `increment(key, { amount, ttlInSeconds })` to `ICacheStorageComponent`: an atomic counter that returns the post-increment `value` and the counter's `ttlRemainingInMilliseconds`. The TTL is applied only when the counter is created, or when an existing counter has no expiry at all, so a fixed window never slides. The Redis implementation runs the whole operation as a single Lua script (`INCRBY` + `PTTL` + conditional `PEXPIRE`); the in-memory implementation performs the read-modify-write in one synchronous block and uses lru-cache's `noUpdateTTL` to anchor the expiry to creation. A non-positive `ttlInSeconds` is rejected in both, since `PEXPIRE key 0` deletes the key in Redis while lru-cache reads a per-call `ttl: 0` as "never expire".

  This is what makes counting workloads (rate limiting, quotas) correct on a shared store: `get` + `set` loses updates across a network round trip, and `acquireLock` costs several extra round trips per call.

  Redis invokes its Lua scripts (`increment` and `releaseLock`) with `EVALSHA` rather than `EVAL`, so a per-request workload sends a 40-byte digest instead of re-uploading the script body every call. A `NOSCRIPT` reply falls back to sending the body, which keeps it correct across a restart, failover or `SCRIPT FLUSH` as well as on a cold cache.

  Per-operation logging in `@dcl/redis-component` moved to **debug** level. Every operation rethrows what it caught, so the caller owns the severity and the context; logging at error here as well double-reported the same failure.

  Startup keeps a louder voice, because it has no caller to report to: `start()` logs at error when the connection rejects, and the client's `error` event logs at warn the first time it fires before any successful connection. `connect()` does not reject on an unreachable server — it retries — so `start()` stays pending and its own catch never runs; without that line a service booting against a dead Redis hangs silently. It is emitted once rather than per retry, and the URL is redacted, since a Redis URL carries its password in the userinfo.

  ## Note for anyone mocking the interface

  This is an additive minor. Consuming code that _calls_ `ICacheStorageComponent` needs no change.

  The one place it is felt is a test double that reimplements the entire interface — `jest.Mocked<ICacheStorageComponent>` and hand-written object literals — which is tighter coupling to the interface shape than a consumer actually needs. Those see `TS2741` whenever they next widen their range, and the fix is one line:

  ```ts
  increment: jest.fn().mockResolvedValue({ value: 1 })
  ```

  Nothing moves on its own: every known consumer depends on `^0.10.1`, and a caret range on a `0.x` version locks the minor, so a repo picks this up only when it deliberately bumps.

  ## Two behaviours worth knowing
  - In-memory counters are subject to LRU eviction and can reset before their TTL expires (`max` defaults to 10 000), where Redis counters cannot.
  - The Redis backend lowercases keys in its string and counter operations while the in-memory backend does not, so normalize keys yourself when case-stability matters. Both are documented on the interface and in the two READMEs.

### Patch Changes

- Updated dependencies [6871695]
- Updated dependencies [6871695]
  - @dcl/core-commons@0.11.0

## 2.4.3

### Patch Changes

- 757ff09: harden two security-sensitive comparisons in shared library code (#105):
  - compare the `/metrics` bearer token in constant time (sha-256 digest + `timingSafeEqual`) in `@dcl/uws-http-server` and `@dcl/http-server` instead of `!==`/`!=`, so the check no longer leaks timing or length information about the configured token. `@dcl/http-server` now also validates the `Bearer` authorization scheme (rejecting `Basic <token>` etc.) for parity with `@dcl/uws-http-server`.
  - in `@dcl/memory-cache-component` `keys(pattern)`, escape regex metacharacters before turning `*` globs into `.*` and anchor the result with `^`/`# @dcl/memory-cache-component. this stops a caller-supplied pattern from injecting regex syntax (ReDoS) and makes the match whole-key rather than substring. patterns that relied on the previous unanchored substring matching will need an explicit leading/trailing `\*`.

- Updated dependencies [fcf5367]
  - @dcl/core-commons@0.10.1

## 2.4.2

### Patch Changes

- Updated dependencies [f8b96d7]
  - @dcl/core-commons@0.10.0

## 2.4.1

### Patch Changes

- Updated dependencies [ecae771]
  - @dcl/core-commons@0.9.0

## 2.4.0

### Minor Changes

- f79563a: Add `exists(key)` to `ICacheStorageComponent` and implement it in both Redis and in-memory components.

  `exists` is a presence-only check that avoids transferring the cached value over the wire — useful for set-style caches where callers only care whether they've seen a key before (e.g. a "have we already confirmed this asset exists upstream?" cache). The Redis implementation delegates to `EXISTS`; the in-memory implementation delegates to `LRUCache.has`, which respects expiry and does not bump the LRU recency.

### Patch Changes

- Updated dependencies [f79563a]
  - @dcl/core-commons@0.8.0

## 2.3.0

### Minor Changes

- 6d35bc9: `createInMemoryCacheComponent` now accepts an optional `InMemoryCacheOptions` bag (`{ max?: number; ttl?: number }`) so callers can override the cap (default `10_000`) and the per-entry default TTL (default `1000 * 60 * 60` ms — one hour). Pass `ttl: 0` to disable TTL entirely so entries live until evicted by the LRU cap. Existing call sites are unchanged: when no options are passed the previous defaults apply.

  Use case: components that need the in-memory cache to behave as a complete mirror of an external store (i.e. no implicit expiration) can now reach for this component instead of rolling a private `Map` / `Set`.

## 2.2.4

### Patch Changes

- Updated dependencies [fcef9b9]
  - @dcl/core-commons@0.7.0

## 2.2.3

### Patch Changes

- Updated dependencies [df22de3]
  - @dcl/core-commons@0.6.0

## 2.2.2

### Patch Changes

- 4a6d070: Add the interfaces dependencies
- Updated dependencies [4a6d070]
  - @dcl/core-commons@0.5.1

## 2.2.1

### Patch Changes

- 8faea85: Updates the LRU cache dependency

## 2.2.0

### Minor Changes

- 839b790: Add the acquireLock, releaseLock, tryAcquireLock, and tryReleaseLock functions to the Redis and memory storage components.

### Patch Changes

- Updated dependencies [839b790]
  - @dcl/core-commons@0.5.0

## 2.1.0

### Minor Changes

- 31cc8ef: Adds the new hash functions

### Patch Changes

- Updated dependencies [31cc8ef]
  - @dcl/core-commons@0.4.0

## 2.0.1

### Patch Changes

- Updated dependencies [46ccace]
  - @dcl/core-commons@0.3.0

## 2.0.0

### Major Changes

- 28ea1c4: Introduce memory cache, redis, sqs and sns components
