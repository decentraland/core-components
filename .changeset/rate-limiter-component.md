---
'@dcl/rate-limiter-component': minor
---

Add `@dcl/rate-limiter-component`: a fixed-window rate limiter exposed as a middleware for `@dcl/http-server`, usable server-wide or per route, and backed by any `ICacheStorageComponent` — `@dcl/memory-cache-component` for a single instance, `@dcl/redis-component` for a fleet, chosen purely by wiring. Counting is one atomic `increment` per request, so a burst cannot slip through a read-modify-write race.

```ts
const rateLimiter = createRateLimiterComponent(
  { cache, logs },
  { keyPrefix: 'my-service:rl', trustedClientIpHeader: 'cf-connecting-ip' }
)

server.use(rateLimiter.withRateLimitMiddleware())
router.post('/v1/login', rateLimiter.withRateLimitMiddleware({ name: 'login', max: 5, windowSeconds: 60 }), handler)
```

Rate limit activity is reported through `IMetricsComponent`, not the logger: `rate_limiter_requests_total{bucket,handler,outcome,key_source}` and `rate_limiter_store_errors_total{bucket,fail_open}`, with `metricDeclarations` exported for registration. A throttled caller retries, so a log line per rejection would be unbounded write amplification driven by the abuse being blocked, and the useful questions are aggregate ones. `handler` is the router's route template rather than the request path, and the identity is never a label — both would be unbounded cardinality, and the identity would put client addresses on the metrics endpoint.

Rejections are `429`, with how much the caller is told controlled by an ordered `disclosure` scale: `NONE` sends the status code alone — no `Retry-After`, no `RateLimit-*` and no body, since a body naming the limit is disclosure too — then `RETRY_AFTER` (the default) adds the delay and a generic body, `ON_LIMIT` adds the standard `RateLimit-Limit`/`-Remaining`/`-Reset` triplet to the rejection, and `ALWAYS` also sends the triplet on successful responses so a client can pace itself before being throttled. Each level is a superset of the one below, and the level changes only what is disclosed: counting, rejection and metrics are identical at every level. Key derivation runs `getKey` → configured trusted header → `context.remoteAddress` → a shared fallback bucket at a tightened cap. Forwarded headers are read from the **right**, offset by `trustedProxyCount`, because the leftmost entry is client-supplied — reading it would let a caller both evade their own limit and throttle a victim by claiming the victim's address. A store outage fails open by default (`failOpen: false` inverts it), with an `onStoreError` hook so a silently disabled limiter stays visible. `consume(identity, overrides?)` covers non-HTTP call sites.
