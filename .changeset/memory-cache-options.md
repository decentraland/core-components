---
'@dcl/memory-cache-component': minor
---

`createInMemoryCacheComponent` now accepts an optional `InMemoryCacheOptions` bag (`{ max?: number; ttl?: number }`) so callers can override the cap (default `10_000`) and the per-entry default TTL (default `1000 * 60 * 60` ms — one hour). Pass `ttl: 0` to disable TTL entirely so entries live until evicted by the LRU cap. Existing call sites are unchanged: when no options are passed the previous defaults apply.

Use case: components that need the in-memory cache to behave as a complete mirror of an external store (i.e. no implicit expiration) can now reach for this component instead of rolling a private `Map` / `Set`.
