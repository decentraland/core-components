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
- Cached Lua scripts addressed by digest (`EVALSHA`), with an automatic fallback
- Debug-level logging, with failures surfaced by throwing (startup being the exception)

## Logging

Outside startup, every log this component writes is at **debug** level, including per-operation
failures. Each operation rethrows what it caught, so the caller decides the severity and gets to add
its own context; logging at error here as well would double-report the same failure, once without
context and once with.

Startup is louder, because it is the one phase with no caller to report to:

- `start()` logs at **error** when the connection attempt rejects, then rethrows.
- The client's `error` event logs at **warn** the first time it fires before any successful
  connection, then falls back to debug. This matters because `connect()` does **not** reject on an
  unreachable server — it retries — so `start()` stays pending and its own `catch` never runs. Without
  that line, a service booting against a dead Redis hangs with nothing above debug to explain why. It
  is emitted once rather than per retry attempt, and the URL in it is redacted.

Note that a hanging `start()` is node-redis's default retry behaviour, not something this component
imposes. If you would rather fail fast than retry, pass your own `reconnectStrategy`.

## Scripted operations

`increment` and `releaseLock` run Lua server-side. They are invoked with `EVALSHA`, which sends a
40-byte digest rather than the script body — worth having when a per-request workload like a rate
limiter would otherwise re-upload the source on every call. The digest is computed locally (Redis
addresses a cached script by the SHA-1 of its body, so no `SCRIPT LOAD` round trip is needed), and a
`NOSCRIPT` reply falls back to sending the body, which both answers that call and caches the script
for the next one. That fallback is not just a cold-start concern: it is also what makes the component
survive a Redis restart, a failover, or a `SCRIPT FLUSH`.

## Atomic counters

`increment` adds to an integer counter and returns the new value together with the counter's
remaining lifetime, as one indivisible operation — a single Lua script doing `INCRBY`, `PTTL` and a
conditional `PEXPIRE`. Use it for rate limiting, quotas and any other "count events without a lock"
workload: `get` + `set` loses updates across the network round trip, and `acquireLock` costs several
extra round trips per call.

```typescript
const { value, ttlRemainingInMilliseconds } = await cache.increment('quota:0xabc', { ttlInSeconds: 60 })
```

A counter that would pass `Number.MAX_SAFE_INTEGER` raises a `RangeError` rather than returning a
rounded value, since a count that cannot be reported exactly is an error and not an approximation.

`ttlInSeconds` is applied **only when the counter is created** (or when an existing counter has no
expiry), so repeated increments leave the deadline where it is and a fixed window actually
terminates. A non-positive `ttlInSeconds` throws, because `PEXPIRE key 0` would delete the key.

Two things to know:

- **Keys are lowercased** by `increment` and by the string operations (`get`, `set`, `remove`,
  `exists`), so identities differing only in case share a counter — normalize or hash
  case-significant keys yourself. Note the hash operations (`setInHash` and friends) do **not**
  lowercase, and `keys(pattern)` does not lowercase its pattern, so a mixed-case pattern will not
  match a stored key.
- A counter written by `increment` is readable with `get<number>()`, since Redis stores the bare
  integer. The reverse works only for numbers: `set(key, 5)` stores `"5"` and can be incremented,
  while a non-numeric value is JSON-encoded and `INCRBY` rejects it.

## License

MIT
