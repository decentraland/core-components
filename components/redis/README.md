# @dcl/redis-component

Redis cache component for distributed caching with Redis, with an in-memory fallback for local development.

## Installation

```bash
npm install @dcl/redis-component
```

## Usage

### Redis Component (Production)

```typescript
import { createRedisComponent } from '@dcl/redis-component'

const cache = await createRedisComponent('redis://localhost:6379', { logs })
await cache.set('key', value, 3600) // TTL in seconds
const value = await cache.get('key')
```

### In-Memory Component (Local Development)

```typescript
import { createInMemoryCacheComponent } from '@dcl/redis-component'

const cache = createInMemoryCacheComponent()
await cache.set('key', value, 3600) // TTL in seconds
const value = await cache.get('key')
```

Both components implement the same `ICacheStorageComponent` interface, making it easy to switch between Redis and in-memory cache based on your environment.

## Features

- Set/get operations with optional TTL
- Pattern-based key scanning
- Hash operations (setInHash, getFromHash, etc.)
- Distributed locking (acquireLock, releaseLock)
- Automatic JSON serialization (Redis only)
- Connection lifecycle management (Redis only)
- Error handling and logging (Redis only)

## When to Use Each Component

- **Redis Component**: Use in production and staging environments where you need distributed caching, persistence, and shared state across multiple instances.
- **In-Memory Component**: Use in local development when you don't want to run a Redis instance. Provides the same interface but stores data in memory only.

## License

MIT
