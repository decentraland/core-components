# @dcl/redis-component

Redis cache component for distributed caching with Redis.

## Installation

```bash
npm install @dcl/redis-component
```

## Usage

```typescript
import { createRedisComponent } from '@dcl/redis-component'

const cache = await createRedisComponent('redis://localhost:6379', { logs })
await cache.set('key', value, 3600) // TTL in seconds
const value = await cache.get('key')
```

## Features

- Set/get operations with optional TTL
- Pattern-based key scanning
- Automatic JSON serialization
- Connection lifecycle management
- Error handling and logging

## License

MIT
