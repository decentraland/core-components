# Rate Limiter Component (`@dcl/rate-limiter-component`)

A component that exposes a fixed-window rate limiter as a middleware, applicable to the whole server or to individual routes, backed by any `ICacheStorageComponent`.

## Features

- Fixed-window limiting over a shared store, counted with a single atomic operation per request.
- The same code bounds one instance (`@dcl/memory-cache-component`) or a whole fleet (`@dcl/redis-component`) — chosen purely by wiring.
- Global and per-route limits sharing one store, with per-endpoint overrides.
- Configurable key derivation with a safe, tightened fallback when no client address is available.
- Fails open by default on a store outage, with a switch to fail closed.
- Configurable disclosure, from a bare status code up to standard `RateLimit-*` headers on every response.
- Prometheus metrics instead of log lines, labelled by bucket, route and outcome.
- A `consume` API for non-HTTP call sites (websocket handlers, queue consumers, domain actions).

## Usage

```typescript
import { createRateLimiterComponent } from '@dcl/rate-limiter-component'

const rateLimiter = createRateLimiterComponent(
  { cache, logs, metrics },
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
| `trustedClientIpHeader` | `string`  | —              | Header carrying the client address. Only set it when the origin is unreachable except via a proxy. Reports an issue if configured but unusable. |
| `trustedProxyCount`     | `number`  | `1`            | Proxies in front of this service that append to the forwarded header.                              |
| `hashKeys`              | `boolean` | `false`        | Store a SHA-256 digest of the identity instead of the identity itself. Keys carry an `r:`/`h:` tag either way. |

Policy — accepted component-wide and overridable per middleware or per `consume` call:

| Option                       | Type                                     | Default              | Description                                                                    |
| ---------------------------- | ---------------------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `name`                       | `string`                                 | route, else `` `${max}p${windowSeconds}` `` | Overrides the bucket. See **Buckets**. Non-empty, no `:`. |
| `max`                        | `number`                                 | `100`                | Requests allowed per window, per identity.                                     |
| `windowSeconds`              | `number`                                 | `60`                 | Window length, at most `86400`. Phase is per identity, not epoch-aligned.       |
| `getKey`                     | `(ctx) => string \| null \| undefined \| Promise<…>` | —        | Returns the identity to count against. Nullish or empty falls through to the address chain. |
| `skip`                       | `fn \| string[] \| string \| RegExp`     | — (none)             | Requests exempt from counting.                                                 |
| `failOpen`                   | `boolean`                                | `true`               | Allow (`true`) or reject (`false`) when the counter store is unreachable.       |
| `fallbackMaxDivisor`         | `number`                                 | `10`                 | Divides `max` for the shared bucket used when no address is available.          |
| `disclosure`                 | `RateLimitDisclosure`                    | `RETRY_AFTER`        | How much a rejected caller is told. See **Disclosure** below.                    |
| `onLimitExceeded`            | `(ctx, result) => void`                  | —                    | Called on every rejection — the place to increment a metric.                    |
| `onStoreError`               | `(ctx, error) => void`                   | —                    | Called on every counter failure, so a silent fail-open stays visible.           |
| `buildLimitExceededResponse` | `(ctx, result) => IResponse`             | —                    | Replaces the built-in `429`; a throw or nullish return falls back to it.         |

## Buckets

A counter key is `keyPrefix:bucket:window:identity`. The **identity** isolates callers — one IP gets
its own count. The **bucket** decides which *endpoints* draw on the same allowance.

You rarely set it. Inside a router, the bucket is the request's method and route template, so each
endpoint gets its own budget automatically:

```
POST /v1/login      → my-service:rl:POST /v1/login:29778754:r:203.0.113.7
POST /v1/signup     → my-service:rl:POST /v1/signup:29778754:r:203.0.113.7
GET  /v1/notes/:id  → my-service:rl:GET /v1/notes/{id}:29778754:r:203.0.113.7
```

Path parameters are templated (`{id}`), never the request path, so the number of buckets is bounded by
your routes rather than by ids. Methods are separate, since a `GET` and a `POST` on one path rarely
cost the same.

A limiter mounted with `server.use()` runs before routing, so there is no route to attribute the
request to — and bounding everything together is what "global" means there. It falls back to
`` `${max}p${windowSeconds}` ``: one shared allowance across every route.

Set `name` to override, which is for making endpoints deliberately **share** an allowance (several
write endpoints on one budget) or to hold a bucket stable across a route rename:

```typescript
router.post('/v1/notes', rateLimiter.withRateLimitMiddleware({ name: 'writes', max: 20 }), createNote)
router.patch('/v1/notes/:id', rateLimiter.withRateLimitMiddleware({ name: 'writes', max: 20 }), editNote)
```

`consume()` has no request, so it always uses the fallback bucket unless you pass a `name`. So does a
`router.use(limiter)` mount with no path: it matches everything that router serves rather than one
route, so it gets a single allowance for the whole mount.

## Disclosure

How much a rejected caller learns is configurable, because it is a genuine trade-off: telling a
client its limit, window and remaining budget is what lets a well-behaved integration pace itself, and
it also tells someone probing the endpoint exactly how much traffic slips under the threshold and when
the window turns over.

The levels are ordered — each discloses everything the level below does, plus more:

| `disclosure` | Status | `Retry-After` + body | `RateLimit-*` on the 429 | `RateLimit-*` on success |
| --- | :-: | :-: | :-: | :-: |
| `NONE` | ✓ | | | |
| `RETRY_AFTER` *(default)* | ✓ | ✓ | | |
| `ON_LIMIT` | ✓ | ✓ | ✓ | |
| `ALWAYS` | ✓ | ✓ | ✓ | ✓ |

```typescript
// Reveal nothing at all: a bare 429, indistinguishable from any other rejection with that status.
router.post('/v1/login', rateLimiter.withRateLimitMiddleware({ name: 'login', disclosure: RateLimitDisclosure.NONE }), loginHandler)
```

`NONE` withholds the **response body** as well as the headers — `Too many requests` tells a caller its
rejection was a rate limit rather than anything else, which is precisely what that level exists to
hide. The one thing it cannot redact is a body you write yourself: a `buildLimitExceededResponse`
result is served as-is, so at `NONE` keep it empty or generic.

Note the cost of `NONE`: with no `Retry-After`, even a cooperative client has nothing to back off on
and will typically retry immediately. You shed each request but receive more of them. `RETRY_AFTER` is
the default because it says *when* to come back without saying what the limit is — and because window
phase is per identity, the delay it reveals is about that caller alone (see the note on window phase
below). For an unauthenticated, abuse-prone endpoint — login, signup, anything that costs money per
call — `NONE` is still the right choice: it makes a rate limit indistinguishable from any other
rejection with that status.

## Metrics

Rate limit activity is reported as metrics, never logged. A throttled caller retries, so a line per
rejection is unbounded write amplification driven by the very abuse the limiter exists to stop — and
the useful questions are aggregate ones a counter answers directly.

Register the declarations with your metrics component:

```typescript
import { metricDeclarations as rateLimiterMetrics } from '@dcl/rate-limiter-component'

const metrics = await createMetricsComponent({ ...myMetrics, ...rateLimiterMetrics }, { config })
```

| Metric | Labels | Meaning |
| --- | --- | --- |
| `rate_limiter_requests_total` | `bucket`, `handler`, `outcome`, `key_source` | Every counted request. `outcome` is `allowed`, `limited` or `degraded`. |
| `rate_limiter_client_address_issues_total` | `bucket`, `issue` | The client address could not be resolved as configured. See **Key derivation**. |
| `rate_limiter_store_errors_total` | `bucket`, `fail_open` | Counter reads/writes that failed. Non-zero means the limiter is degraded. |

`handler` is the **route template** (`/v1/notes/:id`) taken from the router, empty for a middleware
mounted with `server.use()` before any route matched. It is deliberately never the request path, and
the identity is deliberately not a label at all: ids and IP addresses would create an unbounded number
of series, and would put personal data on the metrics endpoint.

`degraded` is kept separate from `allowed` so a cache outage cannot look like healthy traffic. Three
alerts worth having: a rising `outcome="limited"` rate on one `handler`; any
`rate_limiter_store_errors_total` at all — with `fail_open="true"` that means the limiter has quietly
stopped limiting; and any sustained `rate_limiter_client_address_issues_total`, which means the limiter
is keying on the wrong thing and callers are probably sharing a bucket.

`issue` takes one of four values, each a distinct misconfiguration:

| `issue` | Cause |
| --- | --- |
| `trusted-header-missing` | A header is configured but this request did not carry it — wrong name, or the request bypassed the proxy. |
| `trusted-header-unusable` | The header was there but held no usable address, commonly a `trustedProxyCount` that no longer matches the hops. |
| `forwarding-header-ignored` | A forwarding header arrived while none is configured to be read. |
| `no-client-address` | Nothing to key on at all, so the request took the shared fallback bucket. |

Each is also logged, at most once per ten minutes per issue: often enough to reappear while the
condition lasts (these usually begin at a deploy, not at startup) and bounded regardless of traffic.
The metric counts every affected request, so the log tells you *that* it is happening and the metric
tells you *how much*.

Misconfiguration is still logged (a warning when no client address can be established, or when a
configured trusted header yields nothing), as are store failures. Only the per-rejection event moved
to metrics.

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

### Keying on something other than an address

`getKey` receives the middleware context and returns the identity string to count against — a user, a
tenant, an API key, anything with bounded cardinality:

```typescript
// Signed traffic per wallet; anonymous traffic still bounded per IP, from one limiter.
getKey: ctx => ctx.verification?.auth ?? null
```

The context is typed as whatever the component was created with, so parameterizing it removes the need
for casts in `getKey` and in every hook:

```typescript
const rateLimiter = createRateLimiterComponent<GlobalContext>(
  { cache, logs, metrics },
  { getKey: ctx => ctx.verification?.auth ?? null }   // ctx is GlobalContext, no cast
)
```

Returning `null`, `undefined` or `''` **falls through** to the address chain below, which is what makes
that mixed pattern work. Throwing does too, with a log line — a broken key function must not turn a
request into a `500`. It may be async. Whatever it returns selects a bucket, so it must not be raw
client input, and values over 128 characters are hashed automatically.

### When no trusted header is configured

Leaving `trustedClientIpHeader` unset is correct for a **directly exposed** service: the socket
address really is the client, and nothing is logged. Behind a proxy it is a misconfiguration with a
sharp edge — the socket address is the *proxy's*, so every caller in the world shares one bucket, and
at the **full** `max` rather than the tightened fallback cap, because a socket address was found.

Since a directly exposed service is legitimate, the component cannot warn merely because the option is
unset. It warns when a request carries a forwarding header (`cf-connecting-ip`, `x-forwarded-for`,
`x-real-ip`, `true-client-ip`, `forwarded`) while none is configured to be read — something in front is
reporting the client and being ignored. The header is never *used* on that path, only noticed.

The four cases, for reference:

| Deployment | Keyed on | Cap | Logged |
| --- | --- | --- | --- |
| No header configured, directly exposed | client IP | `max` | nothing — this is correct |
| No header configured, behind a proxy | the proxy's IP — one bucket for all | `max` | `forwarding-header-ignored` |
| Header configured but yields nothing | the proxy's IP — one bucket for all | `max` | `trusted-header-missing` / `-unusable` |
| No client address at all (e.g. uWS) | shared fallback bucket | `max / fallbackMaxDivisor` | `no-client-address` |

Both collapse cases keep the full `max` deliberately: the tightened cap exists for the bucket that is
*known* to be shared, and applying it to a socket address would quietly divide every limit by ten in
local development, where all traffic arrives from `127.0.0.1`. The `key_source` metric label is the
other half of this — `key_source="socket"` dominating on a service you believe sits behind a CDN is the
same signal, visible on a dashboard rather than in a log.

> **Security.** A forwarding header is only trustworthy because the network makes it so. If a caller can reach the origin without passing through the proxy, they control their own bucket — which grants them an unlimited allowance *and* lets them throttle a victim by claiming the victim's address. Set `trustedClientIpHeader` only when the origin is unreachable except through that proxy, and prefer a single-value header written by the edge (`cf-connecting-ip`) over `x-forwarded-for`. A header value that does not parse as an IP address is treated as absent, so garbage cannot mint buckets.

## Testing against a real server

`tests/integration.spec.ts` runs the same scenarios against **both** cache backends over a real
socket — connection, `@dcl/http-server`, router, limiter, cache — because that is the only place a few
things can actually be observed: that the peer address reaches `context.remoteAddress`, that the
router's matched route becomes the bucket, and that a real backend expires a counter rather than
sliding its deadline.

The in-memory half needs nothing. The redis half runs only when `REDIS_URL` is set, and is skipped
otherwise, so a local `pnpm test` stays dependency-free:

```bash
docker run --rm -p 6379:6379 redis:7
REDIS_URL=redis://localhost:6379 pnpm test
```

CI provides a redis service, so both halves run on every pull request.

## Notes

- **The 2x boundary burst.** A caller can spend the full `max` just before its window turns over and `max` again just after — up to `2 × max` requests in a short interval. The sustained rate is still `max` per window. Pick `max` so that `2 × max` is survivable, or shorten the window: `10s/20` has the same sustained rate as `60s/120` with a 6× smaller burst.
- **Window phase is per identity, not aligned to the epoch.** Each identity's boundary is derived from a hash of it, so learning one caller's boundary says nothing about anyone else's. That matters when disclosure is enabled: with epoch-aligned windows a single `Retry-After` would reveal the phase and a second the period, after which a bot could compute every future boundary for every client and deliberately straddle one to take the 2x burst. Per-identity phases reduce that to what a caller could already measure about itself. It also removes the synchronised edge where every counter in the fleet expires at the same instant. The trade-off is that a given client's boundary is no longer a round number, which is one more thing to reason about during an incident.
- **A global and a per-route limiter both count the same request**, once each in their own bucket — the per-route allowance and the global one both apply, which is usually the point. They can no longer collide onto one counter by accident, since the per-route bucket is route-derived and the global one is not.
- **`keyPrefix` must be unique per service** on a shared Redis, or one service's traffic throttles another's.
- **`Retry-After`** is in seconds and never `0` (some clients read `0` as "retry immediately", which is the storm the header exists to prevent). `RateLimit-Reset` is **seconds until the window resets**, not an absolute timestamp — that is what the standardized header name is defined to mean, and epoch seconds there would read as a backoff of tens of thousands of years to a compliant client. It therefore duplicates `Retry-After`, which is what the spec intends; `result.resetAt` carries the absolute instant for hooks that want it. The delay travels in the headers only — the `429` body is a fixed `{ ok: false, message: 'Too many requests' }` and never restates it, so there is one authoritative place for it. `result.retryAfterSeconds` is still passed to `onLimitExceeded` and `buildLimitExceededResponse` if you want it in a custom payload.
- **Failing open is silent.** During a store outage the limiter allows everything and looks exactly like low traffic. The built-in error log is throttled to one line per 10s; wire `onStoreError` to a metric so the state is observable.
- **The fallback bucket is deliberately loud.** When no address can be established every caller shares one bucket at a tightened cap, counted as `no-client-address` and re-logged while it lasts. That is a misconfiguration signal, not a mode to run in.
- **Case-sensitivity.** `@dcl/redis-component` lowercases every key, so identities differing only in case share a bucket. If `getKey` returns case-significant material, set `hashKeys: true`.
- **Counting happens before the handler runs**, so a request the handler later rejects (401, 404) still consumes budget. That is intentional — it is what protects an auth endpoint — but it means "only count successful requests" is not supported.
- **Hooks run on the critical path** and are awaited; keep them to a counter, not an HTTP call. A throw is caught and logged rather than turned into a `500`.
- **`skip` has no default.** For health checks, pass `skip: ['/health/live', '/health/ready']`; for CORS preflight, `skip: (request) => request.method === 'OPTIONS'`.
- **Disclosure does not change enforcement.** Every level counts, rejects and records metrics identically; only what the caller is told differs. Your own dashboards always see the full picture.
- **Skipped requests are not counted and produce no metric** — they never reach the counter.
- **`consume` with an empty identity** is routed to the shared fallback bucket at the tightened cap, not given its own bucket at the full limit — so `consume(session.address ?? '')` degrades safely. A non-string identity throws.
- **Only `@dcl/http-server` populates `context.remoteAddress` today.** `@dcl/uws-http-server` returns the raw uWS app and does not, so a uWS-based service must supply `getKey` or a trusted header, or every caller lands in the shared fallback bucket.
- **Requests rejected before the middleware chain are never counted.** `@dcl/http-server` answers an oversized `Content-Length` with a `413` before any middleware runs, so those requests consume no budget.
- **In integration tests, pass `createTestServerComponent({ remoteAddress })`.** It defaults to no address, which means an untouched suite exercises the fallback bucket rather than the per-client path — a limiter can look tested while its real code path never ran.
- **Give the limiter its own cache instance** when using the in-memory backend. Counter churn shares the LRU with whatever else the service caches, so each evicts the other.
- **Key cardinality.** One key per (bucket, window, identity). A counter's TTL is the remainder of its window plus a grace second, so live keys span one window plus a brief overlap. A distributed attack from many source addresses creates many keys, so keep windows short.
