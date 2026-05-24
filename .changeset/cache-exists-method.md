---
'@dcl/core-commons': minor
'@dcl/redis-component': minor
'@dcl/memory-cache-component': minor
---

Add `exists(key)` to `ICacheStorageComponent` and implement it in both Redis and in-memory components.

`exists` is a presence-only check that avoids transferring the cached value over the wire — useful for set-style caches where callers only care whether they've seen a key before (e.g. a "have we already confirmed this asset exists upstream?" cache). The Redis implementation delegates to `EXISTS`; the in-memory implementation delegates to `LRUCache.has`, which respects expiry and does not bump the LRU recency.
