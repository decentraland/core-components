# Rate Limiter Component (`@dcl/rate-limiter-component`)

A component that exposes a fixed-window rate limiter as a middleware, applicable to the whole server or to individual routes, backed by any `ICacheStorageComponent`.

## Features

- Fixed-window limiting over a shared store, counted with a single atomic operation per request.
- The same code bounds one instance (`@dcl/memory-cache-component`) or a whole fleet (`@dcl/redis-component`) — chosen purely by wiring.
- Global and per-route limits sharing one store, with per-endpoint overrides.
- Configurable key derivation with a safe, tightened fallback when no client address is available.
- Fails open by default on a store outage, with a switch to fail closed.
- `429` + `Retry-After`, plus standard `RateLimit-*` headers.
- A `consume` API for non-HTTP call sites (websocket handlers, queue consumers, domain actions).

## Usage

```typescript
import { createRateLimiterComponent } from '@dcl/rate-limiter-component'

const rateLimiter = createRateLimiterComponent(
  { cache, logs },
  {
    // Namespace per service — several services on one Redis would otherwise share counters.
    keyPrefix: 'my-service:rl',
    trustedClientIpHeader: 'cf-connecting-ip',
    max: 100,
    windowSeconds: 60
  }
)
```

Mount it globally, per route, or both:

```typescript
// Every endpoint, at the component-wide policy.
server.use(rateLimiter.withRateLimitMiddleware())

// A tighter budget on one endpoint, with its own bucket.
router.post('/v1/login', rateLimiter.withRateLimitMiddleware({ name: 'login', max: 5, windowSeconds: 60 }), loginHandler)
```

Outside the HTTP path:

```typescript
const result = await rateLimiter.consume(`address:${sender}`, { name: 'friendship', max: 30 })
if (!result.allowed) {
  throw new FriendshipRateLimitError(result.retryAfterSeconds)
}
```

## Options

Component-wide only — these describe the process and its storage, not an endpoint's policy:

| Option                  | Type      | Default        | Description                                                                                       |
| ----------------------- | --------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `keyPrefix`             | `string`  | `'rate-limit'` | Namespace for every counter key. **Set this per service.**                                         |
| `trustedClientIpHeader` | `string`  | —              | Header carrying the client address. Only set it when the origin is unreachable except via a proxy. |
| `trustedProxyCount`     | `number`  | `1`            | Proxies in front of this service that append to the forwarded header.                              |
| `hashKeys`              | `boolean` | `false`        | Store a SHA-256 digest of the identity instead of the identity itself.                             |

Policy — accepted component-wide and overridable per middleware or per `consume` call:

| Option                       | Type                                     | Default              | Description                                                                    |
| ---------------------------- | ---------------------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `name`                       | `string`                                 | `` `${max}p${windowSeconds}` `` | Bucket the counter lives under.                                     |
| `max`                        | `number`                                 | `100`                | Requests allowed per window, per identity.                                     |
| `windowSeconds`              | `number`                                 | `60`                 | Window length. Windows are aligned to the Unix epoch.                          |
| `getKey`                     | `(ctx) => string \| null \| undefined`   | —                    | Derives the identity; returning nullish falls through to the client address.    |
| `skip`                       | `fn \| string[] \| string \| RegExp`     | — (none)             | Requests exempt from counting.                                                 |
| `failOpen`                   | `boolean`                                | `true`               | Allow (`true`) or reject (`false`) when the counter store is unreachable.       |
| `fallbackMaxDivisor`         | `number`                                 | `10`                 | Divides `max` for the shared bucket used when no address is available.          |
| `emitRateLimitHeaders`       | `RateLimitHeaderMode`                    | `ON_LIMIT`           | When to emit `RateLimit-*`: `NEVER`, `ON_LIMIT`, or `ALWAYS`.                   |
| `onLimitExceeded`            | `(ctx, result) => void`                  | —                    | Called on every rejection — the place to increment a metric.                    |
| `onStoreError`               | `(ctx, error) => void`                   | —                    | Called on every counter failure, so a silent fail-open stays visible.           |
| `buildLimitExceededResponse` | `(ctx, result) => IResponse`             | —                    | Replaces the built-in `429` body/status.                                        |

## Choosing a store

Both cache components implement `ICacheStorageComponent`, so the choice is one line of wiring:

- **`@dcl/memory-cache-component`** — no external dependency, lowest latency. The limit is **per instance**: with `N` replicas the effective limit is `N × max`. Counters are also subject to LRU eviction, so a caller cycling through more distinct keys than the cache's `max` can evict counters early (including their own). Size `max` above your expected distinct-key count.
- **`@dcl/redis-component`** — one shared counter across every replica, at the cost of a round trip per request on the critical path. Use this whenever the service runs more than one instance and the limit is meant to be fleet-wide.

## Key derivation

Precedence, first match wins:

1. `getKey(ctx)`, when it returns a non-empty string.
2. `trustedClientIpHeader`, when present and parseable as an IP address.
3. `context.remoteAddress` — the socket peer, provided by `@dcl/http-server`.
4. A single shared fallback bucket, at `max(1, floor(max / fallbackMaxDivisor))`.

Forwarded headers are read from the **right**, offset by `trustedProxyCount`:

```
X-Forwarded-For: <client-supplied>, <written by proxy 2>, <written by proxy 1>
                                                          ^ trustedProxyCount: 1
```

Each proxy appends the address it saw, so the rightmost entries come from infrastructure you control and the leftmost is whatever the client sent. A header holding fewer entries than the trusted chain would produce is discarded rather than trusted.

> **Security.** A forwarding header is only trustworthy because the network makes it so. If a caller can reach the origin without passing through the proxy, they control their own bucket — which grants them an unlimited allowance *and* lets them throttle a victim by claiming the victim's address. Set `trustedClientIpHeader` only when the origin is unreachable except through that proxy, and prefer a single-value header written by the edge (`cf-connecting-ip`) over `x-forwarded-for`. A header value that does not parse as an IP address is treated as absent, so garbage cannot mint buckets.

## Notes

- **The 2x boundary burst.** Windows are aligned to the Unix epoch, so a caller can spend the full `max` in the last millisecond of one window and `max` again in the first millisecond of the next — up to `2 × max` requests in an arbitrarily short interval. The sustained rate is still `max` per window. Pick `max` so that `2 × max` is survivable, or shorten the window: `10s/20` has the same sustained rate as `60s/120` with a 6× smaller burst.
- **Buckets.** Two limiters share a counter only when both `keyPrefix` and bucket match. The bucket defaults to `` `${max}p${windowSeconds}` ``, so two routes configured with the same limit share one pool — pass `name` to separate them. The mirror image is a footgun: a global `server.use()` limiter and a per-route limiter that resolve to the same bucket count each request **twice**, halving the effective limit. Name the per-route one.
- **`keyPrefix` must be unique per service** on a shared Redis, or one service's traffic throttles another's.
- **`Retry-After`** is always in seconds and never `0` (some clients read `0` as "retry immediately", which is the storm the header exists to prevent). `RateLimit-Reset` is absolute Unix seconds. The delay travels in the header only — the `429` body is a fixed `{ ok: false, message: 'Too many requests' }` and never restates it, so there is one authoritative place for it. `result.retryAfterSeconds` is still passed to `onLimitExceeded` and `buildLimitExceededResponse` if you want it in a custom payload.
- **Failing open is silent.** During a store outage the limiter allows everything and looks exactly like low traffic. The built-in error log is throttled to one line per 10s; wire `onStoreError` to a metric so the state is observable.
- **The fallback bucket is deliberately loud.** When no address can be established every caller shares one bucket at a tightened cap, and the component warns once. That is a misconfiguration signal, not a mode to run in.
- **Case-sensitivity.** `@dcl/redis-component` lowercases every key, so identities differing only in case share a bucket. If `getKey` returns case-significant material, set `hashKeys: true`.
- **Counting happens before the handler runs**, so a request the handler later rejects (401, 404) still consumes budget. That is intentional — it is what protects an auth endpoint — but it means "only count successful requests" is not supported.
- **Hooks run on the critical path** and are awaited; keep them to a counter, not an HTTP call. A throw is caught and logged rather than turned into a `500`.
- **`skip` has no default.** For health checks, pass `skip: ['/health/live', '/health/ready']`; for CORS preflight, `skip: (request) => request.method === 'OPTIONS'`.
- **Key cardinality.** One key per (bucket, window, identity), bounded by TTL to roughly two windows. A distributed attack from many source addresses creates many keys, so keep windows short.
