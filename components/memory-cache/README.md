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

## Features

- LRU (Least Recently Used) eviction policy
- TTL support for automatic expiration
- Pattern-based key filtering
- No external dependencies (local only)
- Fast access times

## Configuration

- Max items: 10,000 (configurable)
- Default TTL: 1 hour
- Automatic cleanup of expired items

## License

MIT
