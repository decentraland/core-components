---
'@dcl/memory-cache-component': major
---

Close the remaining gap between the in-memory and Redis implementations of `ICacheStorageComponent`, plus a handful of type-safety, prototype-safety, and ergonomics fixes.

**Breaking** — the cache no longer applies an implicit 1-hour default TTL. Entries written without an explicit TTL previously expired after an hour; post-change they persist until LRU-evicted. Consumers that relied on the 1-hour expiry must pass the TTL at the write site.

- `keys(pattern)` now escapes regex metacharacters (`.`, `?`, `+`, `(`, `$`, …) and anchors the compiled regex with `^…$`, so `user.id:*` no longer matches `userXid:1` and `user:*` no longer matches `admin_user:123`. The no-pattern and `'*'` cases short-circuit the regex altogether. The filter is now a single-pass iteration over the LRU's own iterator — no `Array.from` allocation just to walk and discard.
- `acquireLock` checks occupancy with `cache.get(key) === undefined` instead of `!cache.has(key)`. `get` distinguishes "absent" from "stored null" (closing the bug where a user-stored `null` was silently overwritten) *and* refreshes LRU recency on every retry, so a contested lock cannot silently age out of the cache during contention. A non-positive `ttlInMilliseconds` is clamped back to the default instead of being forwarded as `{ ttl: 0 }`, which in lru-cache means "never expire" and would otherwise leak a lock indefinitely.
- Removed the cache-wide 1-hour default TTL and aligned every write site with Redis's TTL rules:
  - `set(k, v)` without TTL persists forever (`ttl: 0` in lru-cache), matching Redis `SET` without `EX`. A `set` over an existing TTL'd key clears the TTL, also matching Redis.
  - `setInHash(k, f, v)` on a new key without TTL persists forever; on an existing key it preserves the hash's current expiry via `noUpdateTTL`. Zero / negative TTLs are ignored.
  - `removeFromHash` no longer resets the hash's TTL when leaving fields behind (`HDEL` in Redis never touches the expire).
- `setInHash` mutates the hash in place instead of cloning on every write — O(1) per call versus the previous O(fields). Safe because `getAllHashFields` now returns a shallow clone, so callers can't hold a live reference that observes the mutation. Internal hash storage uses a null-prototype object so `target['__proto__'] = value` writes an own property instead of invoking the `Object.prototype.__proto__` setter and silently clobbering the prototype chain. Hashes seeded with `Object.prototype` (from an older write or from `set(k, {literal})`) are migrated on first write.
- `setInHash` now throws when the key already holds a non-object value, mirroring Redis's `WRONGTYPE` refusal. Previously it silently dropped the existing scalar and replaced it with the new hash.
- `set(k, undefined)` and `setInHash(k, f, undefined)` now throw. lru-cache treats `undefined` as a delete, and Redis's `SET` / `HSET` reject undefined at the wire — the explicit rejection keeps the two implementations interchangeable.
- `getFromHash` checks `Object.prototype.hasOwnProperty` before indexing, so asking for `__proto__` or `constructor` on a hash that did not store them returns `null` instead of leaking prototype values.
- `getAllHashFields` returns a shallow clone of the stored hash; caller-side mutations no longer leak back into the cache.
- `isPlainObject` now inspects the prototype chain — `Map`, `Set`, `Date`, `RegExp`, and class instances are treated as non-hash values by the hash APIs, so they can no longer be mistakenly walked as records.
- `createInMemoryCacheComponent()` accepts an optional `{ max }` option, so callers whose workload exceeds the 10 000-entry default (e.g. using this component as a drop-in for Redis in a test) can raise the ceiling instead of silently hitting LRU eviction.
