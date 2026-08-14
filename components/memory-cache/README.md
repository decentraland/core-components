# @dcl/memory-cache-component

In-memory cache component using LRU cache for local caching.

## Installation

```bash
npm install @dcl/memory-cache-component
```

## Usage

```typescript
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'

const cache = createInMemoryCacheComponent()
await cache.set('key', value, 3600)
const value = await cache.get('key')
```

You can override the cap and the default TTL by passing an options bag:

```typescript
// Larger cap, no implicit expiration (entries live until LRU evicts them).
const cache = createInMemoryCacheComponent({ max: 1_000_000, ttl: 0 })
```

## Features

- LRU (Least Recently Used) eviction policy
- TTL support for automatic expiration
- Atomic counters via `increment`
- Pattern-based key filtering
- No external dependencies (local only)
- Fast access times

## Atomic counters

`increment` adds to an integer counter and returns the new value together with its remaining
lifetime. The read-modify-write happens in a single synchronous block, so it is atomic by
construction for every caller in the process.

```typescript
const { value, ttlRemainingInMilliseconds } = await cache.increment('quota:0xabc', { ttlInSeconds: 60 })
```

A counter that would pass `Number.MAX_SAFE_INTEGER` raises a `RangeError` rather than returning a
rounded value, since a count that cannot be reported exactly is an error and not an approximation.

`ttlInSeconds` is applied **only when the counter is created**, or when an existing counter has no
deadline at all, so repeated increments leave an existing deadline where it is and a fixed window
actually terminates. A non-positive `ttlInSeconds` throws
(the Redis backend would interpret `0` as "delete now" and this one as "never expire", so it is
rejected in both).

> **Counters are subject to LRU eviction.** With `max` at its default of 10 000, a caller cycling
> through more distinct keys than that evicts counters — including their own — before the TTL
> expires. For a rate limiter that means failing *open* under key pressure, which the Redis backend
> does not do. Size `max` above your expected distinct-key count, or use `@dcl/redis-component`.

Also note the limit is **per process**: with `N` instances of a service, an in-memory counter bounds
each one separately, so the effective fleet-wide limit is `N ×` whatever you configured.

## Configuration

`createInMemoryCacheComponent(options?)` accepts:

- `max` — maximum number of items the cache will hold. Must be a positive integer. Defaults to `10_000`.
- `ttl` — default TTL in **milliseconds** applied to every entry. Defaults to `1000 * 60 * 60` (1 hour). Pass `0` to disable TTL entirely so entries live until evicted by the LRU cap. Must not be negative.

Invalid values (non-integer or non-positive `max`, negative or non-finite `ttl`) throw a `TypeError` at construction time so misuse surfaces immediately.

### TTL units — careful

The two `ttl` parameters in this API use **different units**:

| Where | Unit | Example |
| --- | --- | --- |
| `createInMemoryCacheComponent({ ttl })` (constructor default) | milliseconds | `ttl: 60_000` → 60 seconds |
| `cache.set(key, value, ttl)` (per-call override) | seconds | `ttl: 60` → 60 seconds |
| `cache.setInHash(key, field, value, ttlInSecondsForHash)` | seconds | `ttlInSecondsForHash: 60` → 60 seconds |
| `cache.increment(key, { ttlInSeconds })` (per-call override) | seconds | `ttlInSeconds: 60` → 60 seconds |
| `cache.increment(...)` return value (`ttlRemainingInMilliseconds`) | milliseconds | `60000` → 60 seconds left |

The per-call values are passed through `fromSecondsToMilliseconds` internally; only the constructor option is in milliseconds. Watch the unit when switching between defaults and overrides.

## License

MIT
