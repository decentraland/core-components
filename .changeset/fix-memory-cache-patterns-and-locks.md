---
'@dcl/memory-cache-component': minor
---

Close the remaining gap between the in-memory and Redis implementations of `ICacheStorageComponent`, plus a couple of type-safety and ergonomics fixes.

- `keys(pattern)` now escapes regex metacharacters (`.`, `?`, `+`, `(`, `$`, …) and anchors the compiled regex with `^…$`, so `user.id:*` no longer matches `userXid:1` and `user:*` no longer matches `admin_user:123`.
- `acquireLock` now uses `cache.has(key)` instead of comparing `cache.get(key) ?? null` to `null`, closing a hole where a caller's legitimately stored `null` value was treated as an unlocked slot and silently overwritten.
- Removed the cache-wide 1-hour default TTL and aligned every write site with Redis's TTL rules:
  - `set(k, v)` without TTL now persists forever (`ttl: 0` in lru-cache), matching Redis `SET` without `EX`. `set(k, v)` over a key that previously had a TTL clears that TTL as well.
  - `setInHash(k, f, v)` on a new key without TTL persists forever; on an existing key it preserves the hash's current expiry via `noUpdateTTL`. Zero / negative TTLs are ignored, matching the Redis implementation.
  - `removeFromHash` no longer resets the hash's TTL when leaving fields behind (`HDEL` in Redis never touches the expire).
- `getAllHashFields` and `getFromHash` now check that the underlying value is a plain object before treating it as a hash, so a caller who mixed `set()` with the hash APIs no longer gets a scalar back typed as `Record<string, T>`.
- `createInMemoryCacheComponent()` accepts an optional `{ max }` option, so callers whose workload exceeds the 10 000-entry default (e.g. using this component as a drop-in for Redis in a test) can raise the ceiling instead of silently hitting LRU eviction.
