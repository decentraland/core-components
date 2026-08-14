import type { ILoggerComponent } from '@well-known-components/interfaces'
import type { ICacheStorageComponent, IHttpServerComponent } from '@dcl/core-commons'

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
 * When the `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers are emitted.
 * `Retry-After` is always set on a `429`, independently of this setting.
 * @public
 */
export enum RateLimitHeaderMode {
  /** Never emit them. */
  NEVER = 'never',
  /** Emit them only on the `429`. The default. */
  ON_LIMIT = 'on-limit',
  /** Emit them on every response, so a client can back off before it is throttled. */
  ALWAYS = 'always'
}

/**
 * A flexible way to exempt requests from being counted. Mirrors the `skip` option of
 * `@dcl/http-requests-logger-component`:
 * - `string` — compared to `url.pathname` for equality.
 * - `string[]` — exempt when any entry equals `url.pathname`.
 * - `RegExp` — tested against `url.pathname`. Global/sticky flags are stripped, since the same
 *   regex is reused across requests and `lastIndex` would otherwise make matches alternate.
 * - function — receives the request; return `true` to exempt it.
 *
 * A skipped request is neither counted nor rejected. There is **no default**: unlike the request
 * logger, whose default skip list is cosmetic, a limiter that silently stops counting something is
 * a security surprise.
 * @public
 */
export type RateLimitSkipper = ((request: IHttpServerComponent.IRequest) => boolean) | string[] | string | RegExp

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
export type RateLimitPolicyOptions = {
  /**
   * Bucket the counter lives under, appended to `keyPrefix`. Two limiters share a counter if and
   * only if they resolve to the same `keyPrefix` **and** the same bucket.
   *
   * Defaults to `` `${max}p${windowSeconds}` `` — deterministic, so every replica agrees on it and
   * it survives restarts. That means two routes configured with the same limit share one pool; pass
   * an explicit `name` (e.g. `'login'`) to give an endpoint its own budget.
   *
   * Watch the mirror image: a global `server.use()` limiter and a per-route limiter that resolve to
   * the same bucket count each request **twice**, halving the effective limit. Naming the per-route
   * one avoids it.
   */
  name?: string
  /**
   * Requests allowed per window, per identity. Must be a positive integer.
   * @defaultValue 100
   */
  max?: number
  /**
   * Window length in seconds. Must be a positive integer. Windows are aligned to the Unix epoch,
   * not anchored to a caller's first request — see the README note on the 2x boundary burst.
   * @defaultValue 60
   */
  windowSeconds?: number
  /**
   * Derives the identity to count against, taking precedence over every address-based source.
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
    context: IHttpServerComponent.DefaultContext<object>
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
   * When the `RateLimit-*` headers are emitted.
   * @defaultValue RateLimitHeaderMode.ON_LIMIT
   */
  emitRateLimitHeaders?: RateLimitHeaderMode
  /**
   * Called for every rejection, before the response is built — the place to increment a metric. It
   * runs on the request's critical path and is awaited, so keep it cheap: a counter, not an HTTP
   * call. Throwing is caught and logged, since a metrics failure must not turn a `429` into a `500`.
   */
  onLimitExceeded?: (
    context: IHttpServerComponent.DefaultContext<object>,
    result: RateLimitResult
  ) => void | Promise<void>
  /**
   * Called for every counter read/write failure, with the same critical-path and error-swallowing
   * rules as `onLimitExceeded`. Exists because `failOpen` is silent: without a metric here, a
   * limiter that has stopped limiting looks exactly like one that is not being hit. The built-in
   * error log is throttled to avoid flooding during an outage; this hook is not.
   */
  onStoreError?: (
    context: IHttpServerComponent.DefaultContext<object> | undefined,
    error: unknown
  ) => void | Promise<void>
  /**
   * Replaces the built-in `429` body/status. Receives the same `result` the hooks get, so the
   * response can quote `retryAfterSeconds` or a service-specific error code.
   *
   * `Retry-After` is added to whatever this returns **only if it does not already set it**, so a
   * custom response can override the delay but cannot accidentally omit it.
   */
  buildLimitExceededResponse?: (
    context: IHttpServerComponent.DefaultContext<object>,
    result: RateLimitResult
  ) => IHttpServerComponent.IResponse | Promise<IHttpServerComponent.IResponse>
}

/**
 * Component-wide options. The {@link RateLimitPolicyOptions} half can be overridden per middleware;
 * the fields declared here cannot, because they describe the process and its storage rather than an
 * endpoint's policy.
 * @public
 */
export type RateLimiterOptions = RateLimitPolicyOptions & {
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
   * a caller cannot mint unlimited buckets (or oversized Redis keys) by sending garbage.
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
   * value can never become an oversized key.
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
}

/**
 * @public
 */
export type IRateLimiterComponent = {
  /**
   * Counts one call against `identity` and reports whether it is allowed. Use this outside the HTTP
   * path — a websocket message handler, a queue consumer, or a domain action that needs its own
   * budget.
   *
   * Never throws for a store failure: the result carries `storeUnavailable`, and `allowed` follows
   * the configured `failOpen` policy.
   */
  consume: (identity: string, overrides?: RateLimitPolicyOptions) => Promise<RateLimitResult>
  /**
   * Builds a middleware enforcing the component-wide policy, optionally overridden per endpoint.
   * The same handler type works at `server.use()`, `router.use()` and in a route's variadic
   * middleware list. Overrides are validated when this is called, so a bad limit fails at startup
   * rather than on the first request.
   */
  withRateLimitMiddleware: <Context extends object = {}>(
    overrides?: RateLimitPolicyOptions
  ) => IHttpServerComponent.IRequestHandler<Context>
}
