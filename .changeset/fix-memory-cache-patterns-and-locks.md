---
'@dcl/memory-cache-component': minor
---

Harden `keys()` glob matching, stop `acquireLock` from misreading a stored `null` as a free slot, and align `setInHash`'s TTL handling with the Redis implementation.

- `keys(pattern)` now escapes regex metacharacters (`.`, `?`, `+`, `(`, `$`, …) and anchors the compiled regex with `^…$`, so `user.id:*` no longer matches `userXid:1` and `user:*` no longer matches `admin_user:123`.
- `acquireLock` now uses `cache.has(key)` instead of comparing `cache.get(key) ?? null` to `null`, closing a hole where a caller's legitimately stored `null` value was treated as an unlocked slot and silently overwritten.
- `setInHash` uses `noUpdateTTL: true` when no TTL is supplied, preserving the entry's existing expiry instead of implicitly bumping it back to the cache's default. Zero and negative TTLs are now ignored (matching the Redis component's behavior) rather than immediately expiring the entry.
