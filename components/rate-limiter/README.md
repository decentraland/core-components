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

// A tighter budget on one endpoint. It gets its own bucket from the route — no `name` needed.
router.post('/v1/login', rateLimiter.withRateLimitMiddleware({ max: 5, windowSeconds: 60 }), loginHandler)
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
| `getKey`                     | `(ctx) => string \| null \| undefined \| Promise<…>` | —        | Returns the identity to count against. Nullish, empty or blank falls through to the address chain. |
| `skip`                       | `fn \| string[] \| string`               | — (none)             | Requests exempt from counting. No `RegExp` form — see **Notes**.                |
| `failOpen`                   | `boolean`                                | `true`               | Allow (`true`) or reject (`false`) when the counter store is unreachable.       |
| `fallbackMaxDivisor`         | `number`                                 | `10`                 | Divides `max` for the shared bucket used when no address is available.          |
| `disclosure`                 | `RateLimitDisclosure`                    | `RETRY_AFTER`        | How much a rejected caller is told. See **Disclosure** below.                    |
| `onLimitExceeded`            | `(ctx, result) => void`                  | —                    | Called on every rejection, for service-specific reactions; the count is already a metric. |
| `onStoreError`               | `(ctx, error) => void`                   | —                    | Called on every counter failure. Unthrottled, unlike the built-in log.           |
| `buildLimitExceededResponse` | `(ctx, result) => IResponse`             | —                    | Replaces the built-in `429`; a throw or nullish return falls back to it.         |

## Buckets

A counter key is `keyPrefix:bucket:window:r|h:identity`, where `r:` marks a raw identity and `h:` a
hashed one. The **identity** isolates callers — one IP gets its own count. The **bucket** decides which *endpoints* draw on the same allowance.

You rarely set it. Inside a router, the bucket is the matched route template plus the policy, so each
endpoint gets its own budget automatically:

```
POST /v1/login      → my-service:rl:/v1/login 5p60:29778754:r:203.0.113.7
POST /v1/signup     → my-service:rl:/v1/signup 5p60:29778754:r:203.0.113.7
GET  /v1/notes/:id  → my-service:rl:/v1/notes/{id} 100p60:29778754:r:203.0.113.7
```

Path parameters are templated (`{id}`), never the request path, so the number of buckets is bounded by
your routes rather than by ids. The policy (`5p60`) is folded in so two mounts on the same path with
different limits keep their own counters — otherwise a busy endpoint with a large `max` would fill the
counter a small limit reads from and throttle it on traffic that was never its own.

The request **method is deliberately not part of the bucket**, even though a `GET` and a `POST` on one
path can cost very different amounts. The method is chosen by the caller, so including it could only
ever multiply an allowance: `HEAD` routes to a `GET` handler and executes it, which gave every `GET`
endpoint twice its limit, and a route registered for all methods got one limit per method. The two
directions are not symmetric — sharing a bucket is conservative, splitting one is a bypass. If two
methods on one path genuinely need separate budgets, give them separate `name`s.

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

`handler` is the **route template** taken from the router, empty for a middleware mounted with
`server.use()` before any route matched. It is deliberately never the request path, and the identity is
deliberately not a label at all: ids and IP addresses would create an unbounded number of series, and
would put personal data on the metrics endpoint.

Note that `handler` keeps the router's own spelling (`/v1/notes/:id`) while `bucket` templates it
(`GET /v1/notes/{id}`). That is intentional: `handler` matches the label `@dcl/http-server` puts on its
own `http_request_duration_seconds` and `http_requests_total`, so a rate limit can be read alongside the
latency and status of the same route.

`degraded` is kept separate from `allowed` so a cache outage cannot look like healthy traffic. Three
alerts worth having: a rising `outcome="limited"` rate on one `handler`; any
`rate_limiter_store_errors_total` at all — with `fail_open="true"` that means the limiter has quietly
stopped limiting; and any sustained `rate_limiter_client_address_issues_total`, which means the limiter
is keying on the wrong thing and callers are probably sharing a bucket.

`issue` takes one of three values, each a misconfiguration that no caller can trigger:

| `issue` | Cause |
| --- | --- |
| `trusted-header-missing` | A header is configured but this request did not carry it — wrong name, or the request bypassed the proxy. |
| `trusted-header-unusable` | The header was there but held no usable address, commonly a `trustedProxyCount` that no longer matches the hops. |
| `no-client-address` | Nothing to key on at all, so the request took the shared fallback bucket. |

Each is also logged, at most once per ten minutes per issue: often enough to reappear while the
condition lasts (these usually begin at a deploy, not at startup) and bounded regardless of traffic.
The metric counts every affected request, so the log tells you *that* it is happening and the metric
tells you *how much*.

Misconfiguration is still logged as well as counted — the three `issue` values above — as are store
failures. Only the per-rejection event moved to metrics alone.

## Choosing a store

Both cache components implement `ICacheStorageComponent`, so the choice is one line of wiring:

- **`@dcl/memory-cache-component`** — no external dependency, lowest latency. The limit is **per instance**: with `N` replicas the effective limit is `N × max`. Counters are also subject to LRU eviction, so a caller cycling through more distinct keys than the cache's `max` can evict counters early (including their own). Size `max` above your expected distinct-key count.
- **`@dcl/redis-component`** — one shared counter across every replica, at the cost of a round trip per request on the critical path. Use this whenever the service runs more than one instance and the limit is meant to be fleet-wide.

## Key derivation

Precedence, first match wins:

1. `getKey(ctx)`, when it returns a string that is not empty or blank.
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

Returning `null`, `undefined`, `''` or a whitespace-only string **falls through** to the address chain
below, which is what makes that mixed pattern work. Throwing does too, with a log line — a broken key function must not turn a
request into a `500`. It may be async. Whatever it returns selects a bucket, so it must not be raw
client input, and values over 128 characters are hashed automatically.

### When no trusted header is configured

Leaving `trustedClientIpHeader` unset is correct for a **directly exposed** service: the socket
address really is the client, and nothing is logged. Behind a proxy it is a misconfiguration with a
sharp edge — the socket address is the *proxy's*, so every caller in the world shares one bucket, and
at the **full** `max` rather than the tightened fallback cap, because a socket address was found.

**This case is deliberately not reported, and that is a trade.** The only way to detect it from a
request is to notice a forwarding header arriving while none is configured to be read — and a client can
send `x-forwarded-for` at will. Reporting on that would let an outsider raise a warning, and inflate a
counter people alert on, against a service that is configured perfectly. A signal an unauthenticated
caller controls is worse than no signal, so there is none.

What replaces it is not client-controlled: **`key_source="socket"` dominating** on a service you believe
sits behind a proxy says exactly the same thing, on a dashboard, and cannot be forged. Watch that
instead.

The three reported cases, and the one that is not:

| Deployment | Keyed on | Cap | Reported |
| --- | --- | --- | --- |
| No header configured, directly exposed | client IP | `max` | nothing — this is correct |
| No header configured, behind a proxy | the proxy's IP — one bucket for all | `max` | **nothing** — watch `key_source` |
| Header configured but yields nothing | the proxy's IP — one bucket for all | `max` | `trusted-header-missing` / `-unusable` |
| No client address at all (e.g. uWS) | shared fallback bucket | `max / fallbackMaxDivisor` | `no-client-address` |

The header cases above *are* reported, and legitimately so: the trigger there is our own configuration
saying a header will arrive and it not arriving, which no caller can manufacture — if they could reach
the origin directly to omit it, the report is telling you something true and worse.

Both collapse cases keep the full `max` deliberately: the tightened cap exists for the bucket that is
*known* to be shared, and applying it to a socket address would quietly divide every limit by ten in
local development, where all traffic arrives from `127.0.0.1`.

### What a caller cannot influence

The limiter treats every part of a request as untrusted except what the deployment vouches for:

- **The bucket** comes from the matched route and the policy — never the request path and never the
  method, both of which the caller picks. Including the method would multiply an allowance rather than
  divide it, since `HEAD` reaches a `GET` handler.
- **No metric label** is caller-derived. `bucket` and `handler` come from the router, `outcome`,
  `key_source` and `issue` are closed sets. So no request can create a series or inflate a label.
- **Nothing is reported on the mere presence of a header**, because a caller can send any header. The
  reported issues are all "our configuration said X would happen and it did not".
- **Header parsing is bounded by configuration, not by input length.** The forwarded header is read from
  the right and stops at the hop it needs, so a caller cannot make the parse expensive by sending a long
  one.
- **`skip` compares exactly or calls your predicate — it never matches a pattern.** That is the one
  place caller input could have decided whether the limiter runs at all, so the `RegExp` form was
  removed rather than documented (see **Notes**).

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
docker run -d --rm --name rl-test-redis -p 6379:6379 redis:7
REDIS_URL=redis://localhost:6379 pnpm test
docker stop rl-test-redis
```

CI provides a redis service, so both halves run on every pull request.

## Notes

- **The 2x boundary burst.** A caller can spend the full `max` just before its window turns over and `max` again just after — up to `2 × max` requests in a short interval. The sustained rate is still `max` per window. Pick `max` so that `2 × max` is survivable, or shorten the window: `10s/20` has the same sustained rate as `60s/120` with a 6× smaller burst.
- **Window phase is per identity, not aligned to the epoch.** Each identity's boundary is derived from a hash of it, so learning one caller's boundary says nothing about anyone else's. That matters when disclosure is enabled: with epoch-aligned windows a single `Retry-After` would reveal the phase and a second the period, after which a bot could compute every future boundary for every client and deliberately straddle one to take the 2x burst. Per-identity phases reduce that to what a caller could already measure about itself. It also removes the synchronised edge where every counter in the fleet expires at the same instant. The trade-off is that a given client's boundary is no longer a round number, which is one more thing to reason about during an incident.
- **A global and a per-route limiter both count the same request**, once each in their own bucket — the per-route allowance and the global one both apply, which is usually the point. They can no longer collide onto one counter by accident, since the per-route bucket is route-derived and the global one is not.
- **`keyPrefix` must be unique per service** on a shared Redis, or one service's traffic throttles another's.
- **`Retry-After`** is in seconds and never `0` (some clients read `0` as "retry immediately", which is the storm the header exists to prevent). `RateLimit-Reset` is **seconds until the window resets**, not an absolute timestamp — that is what the standardized header name is defined to mean, and epoch seconds there would read as a backoff of tens of thousands of years to a compliant client. It therefore duplicates `Retry-After`, which is what the spec intends; `result.resetAt` carries the absolute instant for hooks that want it. The delay travels in the headers only — the `429` body is a fixed `{ ok: false, message: 'Too many requests' }` and never restates it, so there is one authoritative place for it. `result.retryAfterSeconds` is still passed to `onLimitExceeded` and `buildLimitExceededResponse` if you want it in a custom payload.
- **Failing open is silent.** During a store outage the limiter allows everything and looks exactly like low traffic. `rate_limiter_store_errors_total` counts every failure and the requests are labelled `outcome="degraded"`, so alert on those; the log is throttled to one line per 10s, and `onStoreError` is the unthrottled hook if you want your own reaction.
- **The fallback bucket is deliberately loud.** When no address can be established every caller shares one bucket at a tightened cap, counted as `no-client-address` and re-logged while it lasts. That is a misconfiguration signal, not a mode to run in.
- **Case-sensitivity.** `@dcl/redis-component` lowercases the keys its counter operations touch, so on that backend identities differing only in case share a bucket while on the in-memory one they do not. If `getKey` returns case-significant material, set `hashKeys: true` — the digest is lowercase hex, so both backends then agree.
- **Counting happens before the handler runs**, so a request the handler later rejects (401, 404) still consumes budget. That is intentional — it is what protects an auth endpoint — but it means "only count successful requests" is not supported.
- **Hooks run on the critical path** and are awaited; keep them to a counter, not an HTTP call. A throw is caught and logged rather than turned into a `500`.
- **`skip` has no default, and takes no `RegExp`.** Use the exact list, `skip: ['/health/live', '/health/ready']`, or a predicate, `skip: (request) => request.method === 'OPTIONS'`.

  `@dcl/http-requests-logger-component`'s `skip` does accept a pattern, and this one deliberately does not. There, `skip` decides whether a log line is written; here it decides whether the limit applies at all, and a pattern matched against a caller-chosen pathname is the wrong shape for that switch. It fails in two ways nothing can detect from the pattern itself:

  - **Unanchored**, `/health\//` also matches `/v1/notes/health/live`, so anyone can append a segment and opt out of the limit.
  - **Ambiguous**, `/^\/health\/(.*)+$/` — a natural way to write "anything under `/health/`" — backtracks exponentially on a crafted path: 6.9ms at 18 characters, 26ms at 20, 105ms at 22, **421ms at 24**, roughly doubling per character. Node runs one thread and the blocking is synchronous, so it stalls every other request, and `requestTimeout` cannot fire to stop it. A rate limiter is the worst possible place for that, since the control meant to shed load becomes the load.

  Nothing is lost: pass `request => /…/.test(new URL(request.url).pathname)` if you genuinely need a pattern. It is then plainly your code's decision, with the two caveats above yours to weigh, rather than something this component invites. The same applies to any regex inside `getKey` or the hooks — those also run on the request path against caller input.
- **Disclosure does not change enforcement.** Every level counts, rejects and records metrics identically; only what the caller is told differs. Your own dashboards always see the full picture.
- **Skipped requests are not counted and produce no metric** — they never reach the counter.
- **`consume` with an empty identity** is routed to the shared fallback bucket at the tightened cap, not given its own bucket at the full limit — so `consume(session.address ?? '')` degrades safely. A non-string identity throws.
- **Only `@dcl/http-server` populates `context.remoteAddress` today.** `@dcl/uws-http-server` returns the raw uWS app and does not, so a uWS-based service must supply `getKey` or a trusted header, or every caller lands in the shared fallback bucket.
- **Requests rejected before the middleware chain are never counted.** `@dcl/http-server` answers an oversized `Content-Length` with a `413` before any middleware runs, so those requests consume no budget.
- **In integration tests, pass `createTestServerComponent({ remoteAddress })`.** It defaults to no address, which means an untouched suite exercises the fallback bucket rather than the per-client path — a limiter can look tested while its real code path never ran.
- **Give the limiter its own cache instance** when using the in-memory backend. Counter churn shares the LRU with whatever else the service caches, so each evicts the other.
- **Key cardinality.** One key per (bucket, window, identity). A counter's TTL is the remainder of its window plus a grace second, so live keys span one window plus a brief overlap. A distributed attack from many source addresses creates many keys, so keep windows short.
