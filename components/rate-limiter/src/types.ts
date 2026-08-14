import type { ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import type { ICacheStorageComponent, IHttpServerComponent } from '@dcl/core-commons'
import type { metricDeclarations } from './metrics'

/**
 * Where the identity a request was counted against came from. Surfaced on {@link RateLimitResult}
 * so hooks and logs can tell a per-client decision apart from a shared-bucket one.
 * @public
 */
export enum RateLimitKeySource {
  /** Produced by the configured `getKey`. */
  CUSTOM = 'custom',
  /** Read from the configured `trustedClientIpHeader`. */
  TRUSTED_HEADER = 'trusted-header',
  /** The address of the socket the request arrived on. */
  SOCKET = 'socket',
  /** No client address could be established; the request went to the shared fallback bucket. */
  FALLBACK = 'fallback'
}

/**
 * How much a rejected caller is told about the limit. The levels are ordered: each one discloses
 * everything the level below it does, plus more.
 *
 * Disclosure is a real trade-off rather than a cosmetic one. Telling a client its limit, window and
 * remaining budget is what lets a well-behaved integration pace itself; it also tells someone probing
 * the endpoint exactly how much traffic slips under the threshold and when the window turns over.
 *
 * @public
 */
export enum RateLimitDisclosure {
  /**
   * The status code and nothing else — no `Retry-After`, no `RateLimit-*`, and no response body,
   * since a body naming the limit is itself disclosure. A caller cannot tell a rate limit apart from
   * any other rejection carrying the same status.
   *
   * Note the cost: with no `Retry-After` even a cooperative client has nothing to back off on and
   * will typically retry at once, so you shed each request but receive more of them.
   */
  NONE = 'none',
  /**
   * Adds `Retry-After` and a generic body. Says *when* to come back without saying what the limit,
   * window or remaining budget is. The default, and the convention the rest of the fleet follows.
   */
  RETRY_AFTER = 'retry-after',
  /** Adds the `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` triplet to the rejection. */
  ON_LIMIT = 'on-limit',
  /**
   * Also sends the triplet on successful responses, so a client can watch its budget drain and slow
   * down before being rejected. They are still suppressed on a request served while the counter store
   * is unavailable: the counts are not real then, and advertising `RateLimit-Remaining: 0` would tell
   * a well-behaved client to stop sending for the rest of the window — the opposite of what failing
   * open is for.
   */
  ALWAYS = 'always'
}

/**
 * A way to exempt requests from being counted:
 * - `string` — compared to `url.pathname` for equality.
 * - `string[]` — exempt when any entry equals `url.pathname`.
 * - function — receives the request; return `true` to exempt it.
 *
 * A skipped request is neither counted nor rejected. There is **no default**: unlike the request
 * logger — whose default skip list is cosmetic — a limiter that silently stops counting something is
 * a security surprise, so exemptions must be opted into.
 *
 * A `RegExp` is deliberately **not** accepted, though `@dcl/http-requests-logger-component`'s `skip`
 * takes one. There, `skip` decides whether a log line is written; here it decides whether the limit
 * applies at all, and a pattern matched against a caller-chosen pathname is the wrong shape for that
 * switch. It fails in two ways nothing can detect from the pattern: unanchored, `/health\//` also
 * matches `/v1/notes/health/live`, so anyone can opt out; and ambiguous, `/^\/health\/(.*)+$/`
 * backtracks exponentially on a crafted path — 421ms of CPU for a 24-character request, on a runtime
 * with one thread, so it stalls every other request too. Node has no regex timeout and the blocking is
 * synchronous, so `requestTimeout` cannot save it either.
 *
 * The predicate form loses nothing: pass `request => /…/.test(new URL(request.url).pathname)` if you
 * need a pattern. It is then plainly your code's decision rather than something this component invites.
 *
 * @public
 */
export type RateLimitSkipper = ((request: IHttpServerComponent.IRequest) => boolean) | string[] | string

/**
 * The outcome of counting one request (or one `consume` call) against a bucket.
 * @public
 */
export type RateLimitResult = {
  /** Whether this request fits within the caller's current window. */
  allowed: boolean
  /**
   * Requests allowed per window for this decision. This is the *effective* limit, so it already
   * reflects the tightened cap applied to the shared fallback bucket.
   */
  limit: number
  /** Requests left in the current window; never negative. */
  remaining: number
  /**
   * Seconds until the current window ends, for the `Retry-After` header. Never below `1`:
   * `Retry-After: 0` invites an immediate retry storm, and some clients read it as "retry now".
   */
  retryAfterSeconds: number
  /** Unix epoch milliseconds at which the current window ends and the counter resets. */
  resetAt: number
  /**
   * True only on the request that first exceeded the allowance in this window, so callers can log a
   * rejection once instead of once per retry — under sustained abuse that is the difference between
   * one line and thousands. Always `false` when `storeUnavailable` is true, since a degraded
   * decision is not a real rejection.
   */
  firstRejectionInWindow: boolean
  /**
   * True when the counter could not be read or written. `allowed` then reflects the configured
   * `failOpen` policy rather than an actual count, and `remaining` is `0`.
   */
  storeUnavailable: boolean
  /** How the identity was derived. */
  keySource: RateLimitKeySource
  /**
   * The identity the request was counted against, before namespacing and hashing. May contain an IP
   * address — treat it as personal data when logging.
   */
  identity: string
  /** The bucket segment the counter lives under, i.e. the resolved `name`. */
  bucket: string
}

/**
 * Policy that can differ per endpoint. Accepted both as the component-wide default and as a
 * per-middleware / per-`consume` override; anything omitted from an override inherits the
 * component-wide value.
 * @public
 */
export type RateLimitPolicyOptions<Context extends object = object> = {
  /**
   * Overrides which counter this policy draws from. A **budget boundary, not a label**: two limiters
   * share a counter if and only if they resolve to the same `keyPrefix` **and** the same bucket.
   *
   * Usually you do not need it. Left unset, a request matched by a router buckets by its route
   * template and policy — `/v1/login` and `/v1/signup` get separate budgets automatically, even with
   * identical limits. A limiter mounted with `server.use()` has no route to attribute a request to and
   * is meant to bound everything together, so it falls back to `` `${max}p${windowSeconds}` ``, one
   * shared budget across every route.
   *
   * The request **method is not part of the bucket**, so a `GET` and a `POST` on one path draw on the
   * same allowance. That is deliberate: the caller picks the method, so including it could only
   * multiply an allowance — `HEAD` reaches a `GET` handler, which gave every `GET` endpoint twice its
   * limit. If two methods on one path need separate budgets, give each an explicit, distinct `name`.
   *
   * Set it to make endpoints deliberately **share** one allowance — several write endpoints drawing on
   * a single budget — or to keep a bucket stable across a route rename.
   *
   * Must be a non-empty string that does not contain `:`, which separates the key's segments — a colon
   * here could straddle them and make two different policies share one counter. An invalid value
   * throws when the middleware is built.
   */
  name?: string
  /**
   * Requests allowed per window, per identity. Must be a positive integer.
   * @defaultValue 100
   */
  max?: number
  /**
   * Window length in seconds. Must be a positive integer no greater than `86400` (a day); anything
   * larger is rejected as a probable seconds/milliseconds mix-up.
   *
   * Windows are fixed length rather than anchored to a caller's first request, and their phase is
   * derived per identity and bucket rather than aligned to the Unix epoch, so one caller's boundary
   * says nothing about another's — see the README notes on window phase and the 2x boundary burst.
   * @defaultValue 60
   */
  windowSeconds?: number
  /**
   * Derives the identity to count against, taking precedence over every address-based source.
   *
   * The context is typed as the `Context` the component was created with, so
   * `createRateLimiterComponent<GlobalContext>(...)` lets this read service-specific fields — a
   * verified wallet, an injected component — with no cast.
   * Return a non-empty string to use it, or `null`/`undefined` to fall through to the client
   * address — which is how you key authenticated traffic on a user id while still bounding
   * anonymous traffic per IP.
   *
   * Keep the value's cardinality bounded: every distinct value is a key in the store. Values longer
   * than 128 characters are hashed automatically, and so is everything when `hashKeys` is on. If it
   * throws, the failure is logged and the address-based sources are used instead — a broken key
   * function must not turn a request into a `500`.
   *
   * Security: whatever this reads is a bucket selector. If it reads client-controlled input, a
   * caller can both mint fresh buckets to evade their own limit and steer requests into another
   * client's bucket to get that client throttled.
   */
  getKey?: (
    context: IHttpServerComponent.DefaultContext<Context>
  ) => string | null | undefined | Promise<string | null | undefined>
  /** Requests exempt from counting. See {@link RateLimitSkipper}. No default. */
  skip?: RateLimitSkipper
  /**
   * What to do when the counter store is unreachable.
   * - `true` (default) — **fail open**: allow the request. The limiter is abuse mitigation, and a
   *   cache outage must not take the service down with it.
   * - `false` — **fail closed**: reject with `429`. Choose this only where exceeding the limit is
   *   worse than being unavailable — an endpoint that burns a paid third-party quota per call, or
   *   one where the limit is an authorization control rather than abuse mitigation.
   *
   * Failing open is silent by construction: pair it with `onStoreError` (or alert on the throttled
   * error log) so a limiter that has quietly stopped limiting is visible.
   * @defaultValue true
   */
  failOpen?: boolean
  /**
   * Divisor applied to `max` when no client address could be established and every such caller
   * shares one bucket. The effective limit becomes `max(1, floor(max / fallbackMaxDivisor))`.
   *
   * The shared bucket is a global quota, so leaving the full `max` there means the first `max`
   * requests of each window consume it and everyone else is throttled anyway — the endpoint is
   * degraded either way. Tightening makes a misconfigured deployment fail small and loud instead of
   * funnelling all anonymous traffic through the full per-endpoint cap. Set to `1` to disable.
   * @defaultValue 10
   */
  fallbackMaxDivisor?: number
  /**
   * How much a rejected caller is told about the limit. See {@link RateLimitDisclosure}. A value
   * outside the enum throws rather than being silently treated as the default, so a misspelled
   * `'None'` cannot leave the limit exposed.
   * @defaultValue RateLimitDisclosure.RETRY_AFTER
   */
  disclosure?: RateLimitDisclosure
  /**
   * Called for every rejection, before the response is built — the place to increment a metric. It
   * runs on the request's critical path and is awaited, so keep it cheap: a counter, not an HTTP
   * call. Throwing is caught and logged, since a metrics failure must not turn a `429` into a `500`.
   */
  onLimitExceeded?: (
    context: IHttpServerComponent.DefaultContext<Context>,
    result: RateLimitResult
  ) => void | Promise<void>
  /**
   * Called for every counter read/write failure, with the same critical-path and error-swallowing
   * rules as `onLimitExceeded`. Exists because `failOpen` is silent: without a metric here, a
   * limiter that has stopped limiting looks exactly like one that is not being hit. The built-in
   * error log is throttled to avoid flooding during an outage; this hook is not.
   */
  onStoreError?: (
    context: IHttpServerComponent.DefaultContext<Context> | undefined,
    error: unknown
  ) => void | Promise<void>
  /**
   * Replaces the built-in `429` body/status. Receives the same `result` the hooks get, so the
   * response can quote `retryAfterSeconds` or a service-specific error code.
   *
   * `Retry-After` is added to whatever this returns **only if it does not already set it**, so a
   * custom response can override the delay but cannot accidentally omit it.
   *
   * If it throws or returns nothing, the failure is logged and the built-in `429` is served instead —
   * a broken response builder must not turn a rejection into a `500` with no `Retry-After`.
   *
   * A custom response overrides the body, so at `RateLimitDisclosure.NONE` whatever it returns is
   * served as-is: the level suppresses the headers the component would add, but cannot redact a body
   * the caller chose to write.
   */
  buildLimitExceededResponse?: (
    context: IHttpServerComponent.DefaultContext<Context>,
    result: RateLimitResult
  ) => IHttpServerComponent.IResponse | Promise<IHttpServerComponent.IResponse>
}

/**
 * Component-wide options. The {@link RateLimitPolicyOptions} half can be overridden per middleware;
 * the fields declared here cannot, because they describe the process and its storage rather than an
 * endpoint's policy.
 * @public
 */
export type RateLimiterOptions<Context extends object = object> = RateLimitPolicyOptions<Context> & {
  /**
   * Namespace every counter key is written under. **Set this per service.** Several services
   * pointing at one Redis and leaving the default would share counters, so one service's traffic
   * would throttle another's — and a `keys()`/`FLUSH` by one would wipe the other's state.
   * Something like `'my-service:rl'` is enough. Must be a non-empty string.
   * @defaultValue 'rate-limit'
   */
  keyPrefix?: string
  /**
   * Header carrying the client address, e.g. `'cf-connecting-ip'`, `'x-real-ip'` or
   * `'x-forwarded-for'`. Case-insensitive. When set and present it takes precedence over the socket
   * address, because behind a proxy the socket address is the proxy's and would bucket the whole
   * world together.
   *
   * **Only set this when the origin is unreachable except through that proxy.** A header is
   * client-forgeable; if a caller can reach the origin directly they can pick their own bucket,
   * which both grants them an unlimited allowance and lets them throttle a victim by claiming the
   * victim's address. Prefer a single-value header written by the edge (`cf-connecting-ip`) over
   * `x-forwarded-for`, which sidesteps the hop counting below entirely.
   *
   * A value that does not parse as an IP address is treated as absent rather than used as a key, so
   * a caller cannot mint unlimited buckets (or oversized Redis keys) by sending garbage. When this is
   * configured but yields no address, the component reports it — behind a proxy the socket fallback
   * always succeeds, so the failure would otherwise silently turn the per-client limit into a global
   * one. An empty, blank or non-string value throws at construction rather than quietly disabling the
   * feature.
   *
   * Leaving it unset is correct for a directly exposed service, where the socket address is the
   * client. Behind a proxy it is a misconfiguration: the socket address is the proxy's, so every
   * caller shares one bucket at the full `max`. That case is deliberately **not** reported. The only
   * way to detect it from a request is to notice a forwarding header arriving while none is configured
   * to be read, and any caller can send `x-forwarded-for` at will — so the signal would let an outsider
   * raise a warning and inflate a counter against a service that is configured correctly. Watch
   * `key_source="socket"` dominating instead: it says the same thing and cannot be forged.
   * Surrounding whitespace is trimmed, since a padded header name is not merely unmatched —
   * `Headers.get` rejects it outright.
   */
  trustedClientIpHeader?: string
  /**
   * How many proxies sit in front of this service and append to the forwarded header. The client
   * address is read as the entry `trustedProxyCount` positions from the **right**, because each
   * proxy appends the address it saw: the rightmost entries were written by infrastructure you
   * control, and the leftmost is whatever the client chose to send. A header with fewer entries
   * than this did not come through the expected chain and is discarded.
   *
   * Too high and you start reading client-supplied entries; too low and you read your own proxy's
   * address, collapsing everyone into one bucket. Only relevant for list-valued headers; a
   * single-value header yields a one-element list and the default picks it. Must be a positive
   * integer.
   * @defaultValue 1
   */
  trustedProxyCount?: number
  /**
   * Store a SHA-256 digest of the identity instead of the identity itself. Turn this on when the
   * identity is sensitive (you would rather not keep raw client or wallet addresses in a shared
   * Redis), when it is case-significant (`@dcl/redis-component` lowercases keys, so identities
   * differing only in case would otherwise share a bucket), or when its length is not under your
   * control. Costs you the ability to read a bucket's owner off the key when debugging.
   *
   * Identities longer than 128 characters are hashed regardless of this setting, so an oversized
   * value can never become an oversized key. Either way the stored key carries a short tag (`r:` for
   * a raw identity, `h:` for a digest) so the two encodings cannot collide.
   * @defaultValue false
   */
  hashKeys?: boolean
}

/**
 * The dependencies the limiter needs. `cache` is narrowed to the single operation used, so any
 * `ICacheStorageComponent` satisfies it — `@dcl/memory-cache-component` for a single instance,
 * `@dcl/redis-component` for a fleet — and tests can pass a two-line stub.
 * @public
 */
export type RateLimiterComponents = {
  cache: Pick<ICacheStorageComponent, 'increment'>
  logs: ILoggerComponent
  /**
   * Where rate limit activity is reported. Rejections are counted here rather than logged: a
   * throttled caller retries, so a log line per rejection is unbounded write amplification driven by
   * the abuse the limiter exists to stop, and the useful questions ("which endpoint is being
   * throttled, how much, is it getting worse?") are aggregate questions a counter answers and a log
   * search does not.
   *
   * Register {@link metricDeclarations} with your metrics component so the series exist.
   */
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
}

/**
 * @public
 */
export type IRateLimiterComponent<Context extends object = object> = {
  /**
   * Counts one call against `identity` and reports whether it is allowed. Use this outside the HTTP
   * path — a websocket message handler, a queue consumer, or a domain action that needs its own
   * budget.
   *
   * Never throws for a store failure: the result carries `storeUnavailable`, and `allowed` follows
   * the configured `failOpen` policy. It does throw for an identity that is not a string.
   *
   * An empty or blank identity — `consume(session.address ?? '')` — is routed to the shared fallback
   * bucket at the tightened cap rather than given a bucket of its own at the full limit, matching how
   * the middleware handles a request with no resolvable client address.
   */
  consume: (identity: string, overrides?: RateLimitPolicyOptions<Context>) => Promise<RateLimitResult>
  /**
   * Builds a middleware enforcing the component-wide policy, optionally overridden per endpoint.
   * The same handler type works at `server.use()`, `router.use()` and in a route's variadic
   * middleware list. Overrides are validated when this is called, so a bad limit fails at startup
   * rather than on the first request.
   */
  withRateLimitMiddleware: (
    overrides?: RateLimitPolicyOptions<Context>
  ) => IHttpServerComponent.IRequestHandler<Context>
}
