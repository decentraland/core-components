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
- Pattern-based key filtering
- No external dependencies (local only)
- Fast access times

## Configuration

`createInMemoryCacheComponent(options?)` accepts:

- `max` — maximum number of items the cache will hold. Defaults to `10_000`.
- `ttl` — default TTL in milliseconds applied to every entry. Defaults to `1000 * 60 * 60` (1 hour). Pass `0` to disable TTL entirely so entries live until evicted by the LRU cap.

## License

MIT
