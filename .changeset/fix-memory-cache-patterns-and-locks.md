---
'@dcl/memory-cache-component': minor
---

Close the remaining gap between the in-memory and Redis implementations of `ICacheStorageComponent`, plus a handful of type-safety, prototype-safety, and ergonomics fixes.

- `keys(pattern)` now escapes regex metacharacters (`.`, `?`, `+`, `(`, `$`, …) and anchors the compiled regex with `^…$`, so `user.id:*` no longer matches `userXid:1` and `user:*` no longer matches `admin_user:123`. The no-pattern and `'*'` cases short-circuit the regex altogether.
- `acquireLock` now uses `cache.has(key)` instead of comparing `cache.get(key) ?? null` to `null`, closing a hole where a caller's legitimately stored `null` value was treated as an unlocked slot and silently overwritten. A non-positive `ttlInMilliseconds` is clamped back to the default instead of being forwarded as `{ ttl: 0 }`, which in lru-cache means "never expire" and would otherwise leak a lock indefinitely.
- Removed the cache-wide 1-hour default TTL and aligned every write site with Redis's TTL rules:
  - `set(k, v)` without TTL persists forever (`ttl: 0` in lru-cache), matching Redis `SET` without `EX`. A `set` over an existing TTL'd key clears the TTL, also matching Redis.
  - `setInHash(k, f, v)` on a new key without TTL persists forever; on an existing key it preserves the hash's current expiry via `noUpdateTTL`. Zero / negative TTLs are ignored.
  - `removeFromHash` no longer resets the hash's TTL when leaving fields behind (`HDEL` in Redis never touches the expire).
- `setInHash` now throws when the key already holds a non-object value, mirroring Redis's `WRONGTYPE` refusal. Previously it silently dropped the existing scalar and replaced it with the new hash.
- `set(k, undefined)` now throws. lru-cache treats `set(k, undefined)` as a delete; the Redis implementation would reject the value. Making it an explicit error in both places keeps the two implementations interchangeable.
- `getFromHash` checks `Object.prototype.hasOwnProperty` before indexing, so asking for `__proto__` or `constructor` on a hash that did not store them returns `null` instead of leaking prototype values.
- `isPlainObject` now inspects the prototype chain — `Map`, `Set`, `Date`, `RegExp`, and class instances are treated as non-hash values by `setInHash` / `getFromHash` / `getAllHashFields`, so they can no longer be mistakenly walked as records.
- `getAllHashFields` and `getFromHash` still return an empty record / `null` when called on a key that holds a non-object value (reads remain lenient; writes reject).
- `createInMemoryCacheComponent()` accepts an optional `{ max }` option, so callers whose workload exceeds the 10 000-entry default (e.g. using this component as a drop-in for Redis in a test) can raise the ceiling instead of silently hitting LRU eviction.
