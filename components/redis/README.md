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
- Atomic counters via `increment`
- Pattern-based key scanning
- Automatic JSON serialization
- Connection lifecycle management
- Error handling and logging

## Atomic counters

`increment` adds to an integer counter and returns the new value together with the counter's
remaining lifetime, as one indivisible operation — a single Lua `EVAL` doing `INCRBY`, `PTTL` and a
conditional `PEXPIRE`. Use it for rate limiting, quotas and any other "count events without a lock"
workload: `get` + `set` loses updates across the network round trip, and `acquireLock` costs several
extra round trips per call.

```typescript
const { value, ttlRemainingInMilliseconds } = await cache.increment('quota:0xabc', { ttlInSeconds: 60 })
```

`ttlInSeconds` is applied **only when the counter is created** (or when an existing counter has no
expiry), so repeated increments leave the deadline where it is and a fixed window actually
terminates. A non-positive `ttlInSeconds` throws, because `PEXPIRE key 0` would delete the key.

Two things to know:

- **Keys are lowercased.** Every operation in this component calls `toLowerCase()` on the key, so
  identities differing only in case share a counter. Normalize or hash case-significant keys yourself.
- A counter written by `increment` is readable with `get<number>()` (Redis stores the bare integer),
  but the reverse does not hold: a value written with `set` is JSON-encoded, and `INCRBY` rejects it.

## License

MIT
