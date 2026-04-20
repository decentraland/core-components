---
'@dcl/memory-cache-component': major
'@dcl/core-commons': minor
---

Close the remaining gap between the in-memory and Redis implementations of `ICacheStorageComponent`, plus a handful of type-safety, prototype-safety, ergonomics, and API-surface improvements.

**Breaking** — the cache no longer applies an implicit 1-hour default TTL. Entries written without an explicit TTL previously expired after an hour; post-change they persist until LRU-evicted. Consumers that relied on the 1-hour expiry must pass the TTL at the write site.

`@dcl/core-commons` ships an additive `AcquireLockOptions` type and adds an optional `signal: AbortSignal` to the lock-acquisition options on `ICacheStorageComponent` (minor bump — purely additive).

- `keys(pattern)` is a full Redis-style glob compiler: `*` (any run), `?` (any single char), `[...]` character classes with `!` negation and `a-z` ranges, and `\\` as a literal escape. Regex metacharacters are escaped so `user.id:*` no longer matches `userXid:1`. The pattern compiles to an anchored `^…$` regex and is iterated single-pass over the LRU's own iterator — no `Array.from` pre-allocation for patterns that match a handful of keys. No-pattern and `*` short-circuit; `''` deliberately does not (matching Redis `SCAN MATCH ''`'s empty-string-keys-only semantics).
- `acquireLock` / `tryAcquireLock` accept an optional `signal: AbortSignal` that rejects the pending acquisition with the signal's reason (or an `AbortError`) the moment abort fires — between retries, or before the first attempt if the signal is already aborted.
- `acquireLock` now validates `retries` (non-negative integer), `retryDelayInMilliseconds` (non-negative finite number), and `ttlInMilliseconds` (finite number) and throws a descriptive `TypeError` instead of silently misbehaving on `NaN` / `Infinity` / negative values.
- `acquireLock` checks occupancy with `cache.get(key) === undefined` instead of `!cache.has(key)`. `get` distinguishes "absent" from "stored null" (closing the bug where a user-stored `null` was silently overwritten) and refreshes LRU recency on every retry so a contested lock cannot silently age out of the cache during contention. A non-positive `ttlInMilliseconds` is clamped back to the default instead of being forwarded as `{ ttl: 0 }` (lru-cache: "never expire"), which would leak a lock indefinitely.
- Removed the cache-wide 1-hour default TTL and aligned every write site with Redis's TTL rules:
  - `set(k, v)` without TTL persists forever (`ttl: 0` in lru-cache), matching Redis `SET` without `EX`. A `set` over an existing TTL'd key clears the TTL, also matching Redis.
  - `setInHash(k, f, v)` on a new key without TTL persists forever; on an existing key it preserves the hash's current expiry via `noUpdateTTL`. Zero / negative TTLs are ignored.
  - `removeFromHash` no longer resets the hash's TTL when leaving fields behind (`HDEL` in Redis never touches the expire).
- `setInHash` mutates the hash in place instead of cloning on every write — O(1) per call versus the previous O(fields). Safe because `getAllHashFields` now returns a shallow clone. Internal hash storage uses a null-prototype object so `target['__proto__'] = value` writes an own property instead of invoking the `Object.prototype.__proto__` setter. Hashes seeded with `Object.prototype` (from an older write or from `set(k, {literal})`) are migrated on first write.
- `setInHash` now throws when the key already holds a non-object value, mirroring Redis's `WRONGTYPE` refusal. Previously it silently dropped the existing scalar and replaced it with the new hash.
- `set(k, undefined)` and `setInHash(k, f, undefined)` now throw. lru-cache treats `undefined` as a delete, and Redis's `SET` / `HSET` reject undefined at the wire — the explicit rejection keeps the two implementations interchangeable.
- `getFromHash` checks `Object.prototype.hasOwnProperty` before indexing, so asking for `__proto__` or `constructor` on a hash that did not store them returns `null` instead of leaking prototype values.
- `getAllHashFields` returns a shallow clone of the stored hash; caller-side mutations no longer leak back into the cache.
- `isPlainObject` now inspects the prototype chain — `Map`, `Set`, `Date`, `RegExp`, and class instances are treated as non-hash values by the hash APIs.
- `createInMemoryCacheComponent()` accepts an optional `{ max, logs }` options object. `max` raises the 10 000-entry ceiling when used as a Redis drop-in; `logs` threads an `ILoggerComponent` through so the memory-backed implementation emits the same lock-acquire debug lines the Redis one does.
