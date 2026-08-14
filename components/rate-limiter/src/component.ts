import { isIP } from 'net'
import { createHash } from 'crypto'
import { isErrorWithMessage, type IHttpServerComponent } from '@dcl/core-commons'
import { CacheIncrementUnsupportedError, InvalidRateLimitConfigurationError } from './errors'
import { metricDeclarations, RateLimitAddressIssue, RateLimitOutcome } from './metrics'
import {
  IRateLimiterComponent,
  RateLimiterComponents,
  RateLimiterOptions,
  RateLimitDisclosure,
  RateLimitKeySource,
  RateLimitPolicyOptions,
  RateLimitResult,
  RateLimitSkipper
} from './types'

const DEFAULT_MAX = 100
const DEFAULT_WINDOW_SECONDS = 60
const DEFAULT_KEY_PREFIX = 'rate-limit'
const DEFAULT_TRUSTED_PROXY_COUNT = 1
const DEFAULT_FALLBACK_MAX_DIVISOR = 10

/** Bucket shared by every request whose client address could not be established. */
export const FALLBACK_IDENTITY = 'unidentified-client'

/** Identities longer than this are hashed, so an oversized value can't become an oversized key. */
export const MAX_RAW_IDENTITY_LENGTH = 128

/** `::ffff:cb00:710a`, the canonical serialization of an IPv4-mapped address. */
const IPV4_MAPPED_IPV6 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/

// Extra second on a counter's TTL so it can never expire before the window it belongs to ends,
// whatever rounding the store applies. Over-living is harmless: the next window uses a different
// key, so the counter is never read again once its window id has moved on.
const COUNTER_TTL_GRACE_SECONDS = 1

// How often a client-address misconfiguration is re-logged while it persists. Warning once per
// process is not enough: the condition usually starts at a deploy or a CDN change, long after startup,
// and a single line that scrolled past hours ago is not something anyone alerts on. Re-stating it on a
// slow interval keeps the signal alive and stays bounded no matter the request rate.
const ADDRESS_ISSUE_LOG_INTERVAL_MS = 10 * 60_000

// A store outage produces one failure per request; log at most this often instead.
const STORE_ERROR_LOG_INTERVAL_MS = 10_000

// A day. Beyond this a `windowSeconds` value is far more likely to be milliseconds by mistake than
// a genuine window.
const MAX_WINDOW_SECONDS = 86_400

const DISCLOSURE_LEVELS = new Set<string>(Object.values(RateLimitDisclosure))

// Anything but `:`, which is the key's segment separator, and non-empty.
const VALID_BUCKET_NAME = /^[^:\s][^:]*$/

export function assertPositiveInteger(setting: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new InvalidRateLimitConfigurationError(setting, value)
  }
}

// Strips the `host:port` / `[host]:port` spellings some proxies emit (Azure Application Gateway
// among them). Without this, such a deployment fails every address parse and silently collapses
// into the shared fallback bucket — a very quiet way to lose per-client limiting.
function stripPort(value: string): string {
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(value)
  if (bracketed) return bracketed[1]
  // Only strip a port from something unambiguously IPv4:port; a bare IPv6 address is full of
  // colons and must be left alone.
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value)
  return ipv4WithPort ? ipv4WithPort[1] : value
}

/**
 * Collapses every spelling of one address into a single form, so one client is one bucket.
 * Zero-compression, leading zeros and case make a single IPv6 address writable many ways, and an
 * IPv4 client can be reported either as a dotted quad or in IPv4-mapped form.
 *
 * @returns The canonical address, or `null` when the value is not an IP address.
 */
export function canonicalizeIpAddress(value: string | null | undefined): string | null {
  if (!value) return null
  const withZone = stripPort(value.trim())

  // A link-local address carries a `%interface` suffix that `new URL()` rejects, so the whole value
  // used to come back `null` and every zoned peer landed in the shared fallback bucket. Canonicalize
  // the address, then re-attach the zone, which keeps peers on different interfaces distinct — the
  // same reasoning `@dcl/http-server`'s `normalizeRemoteAddress` uses when it preserves the zone.
  const zoneAt = withZone.indexOf('%')
  if (zoneAt > 0) {
    const canonical = canonicalizeIpAddress(withZone.slice(0, zoneAt))
    return canonical === null ? null : `${canonical}%${withZone.slice(zoneAt + 1)}`
  }

  const candidate = withZone
  const version = isIP(candidate)
  // Anything that is not an address would let a caller mint unlimited buckets.
  if (version === 0) return null
  // IPv4 needs no canonical step: `isIP` already rejects the alternative spellings, e.g. the
  // leading zeros in 203.0.113.010.
  if (version === 4) return candidate

  let canonical: string
  try {
    // The URL host of an IPv6 literal is bracketed and canonically serialized.
    canonical = new URL(`http://[${candidate}]`).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return null
  }

  const mapped = IPV4_MAPPED_IPV6.exec(canonical)
  if (!mapped) return canonical

  const high = parseInt(mapped[1], 16)
  const low = parseInt(mapped[2], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

/**
 * Picks the client address out of a forwarded header.
 *
 * Every proxy **appends** the address it saw, so the rightmost entries were written by our own
 * infrastructure and the leftmost is whatever the client chose to send. Reading the leftmost — the
 * common shortcut — hands a caller two primitives at once: an unlimited allowance (rotate the value,
 * get a fresh bucket every request) and a targeted denial of service (claim a victim's address and
 * spend their budget). So we count in from the right instead.
 *
 * @param value - The raw header value. `Headers.get` joins repeated header lines with commas, so
 *   one split handles both spellings.
 * @param trustedProxyCount - Number of proxies in front of this service that append to the header.
 * @returns The canonical address, or `null` when the header is absent, holds fewer entries than the
 *   trusted chain would produce (so it did not come through that chain), or the selected entry is
 *   not an address.
 */
export function clientIpFromForwardedHeader(value: string | null, trustedProxyCount: number): string | null {
  if (!value) return null

  // Walks backwards and stops at the hop it wants, rather than splitting the whole header first.
  // Splitting made the work proportional to the header's length, which the caller chooses: at Node's
  // default 16KB header cap that measured ~0.5ms of parsing on every request, for a request that costs
  // the caller nothing. Reading from the right needs only the last `trustedProxyCount` entries, so the
  // work is bounded by configuration instead. Empty entries are skipped rather than counted, matching
  // the `filter` this replaced.
  let end = value.length
  let seen = 0
  for (;;) {
    // `lastIndexOf(',', -1)` clamps its start to 0 and so keeps finding a *leading* comma, which would
    // never advance. Once the whole value is consumed there is no separator left to find.
    const comma = end === 0 ? -1 : value.lastIndexOf(',', end - 1)
    const hop = value.slice(comma + 1, end).trim()
    if (hop.length > 0) {
      seen += 1
      if (seen === trustedProxyCount) return canonicalizeIpAddress(hop)
    }
    // Ran out of entries before reaching the trusted chain's depth, so this did not come through it.
    if (comma < 0) return null
    end = comma
  }
}

/**
 * A stable per-identity offset, in `[0, windowMs)`, that shifts where this identity's windows fall.
 *
 * Derived from the identity so it is deterministic — every replica computes the same phase without
 * coordinating, which is what keeps a shared counter correct.
 */
export function windowOffsetFor(identity: string, windowMs: number): number {
  // 32 bits of the digest is ample for a phase and keeps the arithmetic inside a safe integer.
  const digest = createHash('sha256').update(identity).digest()
  return digest.readUInt32BE(0) % windowMs
}

/**
 * The window an identity is currently in, and the instant it resets.
 *
 * Windows are fixed-length and their phase is **per identity** rather than aligned to the Unix epoch.
 * Alignment would make every boundary global and permanent: a single `Retry-After` would reveal the
 * phase, a second would reveal the period, and from then on a caller could compute every future
 * boundary for every client — and deliberately spend a full allowance on each side of one, which is
 * the 2x burst a fixed window inherently permits. Offsetting per identity means a caller learns only
 * its own boundary, which it could have measured anyway, so disclosing the delay gives away nothing
 * systemic. It also removes the synchronised reset edge where every counter in the fleet expires at
 * the same instant.
 *
 * The offset is folded into the window id, so the id stays a plain integer and the key format is
 * unchanged.
 */
export function currentWindow(
  now: number,
  windowMs: number,
  offsetMs: number = 0
): { windowId: number; resetAt: number } {
  const shifted = now + offsetMs
  const windowId = Math.floor(shifted / windowMs)
  // Shift back, so `resetAt` is a real instant on the caller's clock rather than in offset space.
  return { windowId, resetAt: (windowId + 1) * windowMs - offsetMs }
}

/**
 * Namespaces a counter. `windowId` sits ahead of the identity so one window's counters share a
 * prefix and can be enumerated or dropped with a single `SCAN MATCH prefix:bucket:12345:*`.
 */
export function buildCounterKey(keyPrefix: string, bucket: string, windowId: number, identity: string): string {
  return `${keyPrefix}:${bucket}:${windowId}:${identity}`
}

/**
 * Encodes the identity for storage. The digest is lowercase hex, which is also the only encoding
 * that survives `@dcl/redis-component` lowercasing every key. 32 hex characters is 128 bits, so
 * collisions are not a practical concern — and a collision only merges two buckets.
 */
export function encodeIdentity(identity: string, hashKeys: boolean): string {
  // The `r:`/`h:` tag keeps the two encodings in separate keyspaces. Without it a caller could send
  // the 32-hex digest of a long victim identity as its own (short, so stored raw) identity and land
  // on the victim's counter — and mixed-length identities could collide by accident.
  if (!hashKeys && identity.length <= MAX_RAW_IDENTITY_LENGTH) return `r:${identity}`
  return `h:${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
}

/**
 * Mirrors `shouldSkip` from `@dcl/http-requests-logger-component`. Duplicated rather than imported:
 * a rate limiter must not depend on a logging package.
 */
export function shouldSkip(
  context: IHttpServerComponent.DefaultContext<object>,
  skipper: RateLimitSkipper
): boolean {
  if (typeof skipper === 'string') return skipper === context.url.pathname
  if (Array.isArray(skipper)) return skipper.some(path => path === context.url.pathname)
  if (typeof skipper === 'function') return skipper(context.request)
  // Strip the global/sticky flags: the same regex is reused across requests, and `.test()` on a
  // global/sticky regex advances `lastIndex`, which would make matches alternate per call.
  const statelessRegExp =
    skipper.global || skipper.sticky ? new RegExp(skipper.source, skipper.flags.replace(/[gy]/g, '')) : skipper
  return statelessRegExp.test(context.url.pathname)
}

type ResolvedPolicy<Context extends object> = Required<
  Pick<RateLimitPolicyOptions<Context>, 'max' | 'failOpen' | 'disclosure'>
> &
  Pick<
    RateLimitPolicyOptions<Context>,
    'skip' | 'getKey' | 'onLimitExceeded' | 'onStoreError' | 'buildLimitExceededResponse'
  > & {
    /**
     * Used when the request is not inside a router layer — i.e. a limiter mounted with
     * `server.use()`, where one shared budget across every route is what "global" means.
     */
    name: string | undefined
    fallbackBucket: string
    windowMs: number
    fallbackMax: number
  }

/**
 * Creates a fixed-window rate limiter that can be applied to the whole server or to individual
 * routes, backed by any `ICacheStorageComponent`.
 *
 * Counters live in the injected cache, so the same code bounds a single instance
 * (`@dcl/memory-cache-component`) or a whole fleet (`@dcl/redis-component`) depending purely on how
 * it is wired. Counting is one atomic `increment` per request — no read-modify-write, so a burst
 * (the traffic this exists to bound) cannot slip through a race.
 *
 * @throws {InvalidRateLimitConfigurationError} When a setting is out of range, so a
 * misconfiguration fails at boot instead of silently rejecting or allowing everything.
 * @throws {CacheIncrementUnsupportedError} When the cache predates the `increment` primitive.
 * @public
 */
export function createRateLimiterComponent<Context extends object = object>(
  components: RateLimiterComponents,
  options: RateLimiterOptions<Context> = {}
): IRateLimiterComponent<Context> {
  const { cache, logs, metrics } = components
  const logger = logs.getLogger('rate-limiter')

  // A cache from an older release would fail per request, deep inside the fail-open path, where the
  // failure looks exactly like an outage. Surface it at construction instead.
  if (typeof cache?.increment !== 'function') {
    throw new CacheIncrementUnsupportedError()
  }

  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX
  if (typeof keyPrefix !== 'string' || keyPrefix.length === 0) {
    throw new InvalidRateLimitConfigurationError('keyPrefix', keyPrefix)
  }

  if (options.trustedClientIpHeader !== undefined) {
    // Validated rather than coerced: an empty string silently disables the whole feature (the
    // lookup below is guarded on truthiness), which is what `process.env.CLIENT_IP_HEADER ?? ''`
    // produces, and a non-string used to throw a bare `TypeError` out of `toLowerCase`.
    if (typeof options.trustedClientIpHeader !== 'string' || options.trustedClientIpHeader.trim().length === 0) {
      throw new InvalidRateLimitConfigurationError('trustedClientIpHeader', options.trustedClientIpHeader)
    }
  }
  // Trimmed, not merely validated as non-blank: `Headers.get(' cf-connecting-ip ')` does not miss —
  // it throws `Invalid header name`, so a padded value (what `CLIENT_IP_HEADER=" x "` in an env file
  // produces) would raise on every request rather than quietly falling back to the socket address.
  const trustedClientIpHeader = options.trustedClientIpHeader?.trim().toLowerCase()
  const trustedProxyCount = options.trustedProxyCount ?? DEFAULT_TRUSTED_PROXY_COUNT
  assertPositiveInteger('trustedProxyCount', trustedProxyCount)
  const hashKeys = options.hashKeys ?? false

  // Scoped to this instance rather than the module, so a service running several limiters with
  // different key configs hears about each one — and so tests need no reset hatch in production code.
  // Derived bucket names, keyed by method and matched route, so the per-request string work happens
  // once per endpoint. Bounded by routes times methods, and only written for paths the router matched.
  const bucketByRoute = new Map<string, string>()
  const addressIssueLoggedAt = new Map<RateLimitAddressIssue, number>()
  let lastStoreErrorLoggedAt = 0
  let lastMetricErrorLoggedAt = 0

  /**
   * Records a client-address misconfiguration: always as a metric, and as a log line at most once per
   * {@link ADDRESS_ISSUE_LOG_INTERVAL_MS} so the message keeps reappearing while the condition lasts
   * without scaling with traffic.
   */
  function reportAddressIssue(issue: RateLimitAddressIssue, bucket: string, message: string): void {
    recordMetric('rate_limiter_client_address_issues_total', { bucket, issue })

    const now = Date.now()
    const lastLoggedAt = addressIssueLoggedAt.get(issue)
    if (lastLoggedAt === undefined || now - lastLoggedAt >= ADDRESS_ISSUE_LOG_INTERVAL_MS) {
      addressIssueLoggedAt.set(issue, now)
      logger.warn(message, { issue })
    }
  }

  /**
   * Which counter this request draws from.
   *
   * An explicit `name` always wins. Otherwise, a request inside a router layer buckets by its method
   * and matched route, so `POST /v1/login` and `POST /v1/signup` get separate budgets even when their
   * limits are identical — the alternative silently merged them, because the fallback bucket is
   * derived from the limit values. Outside a router layer there is no route to attribute the request
   * to, and a limiter mounted with `server.use()` is meant to bound everything together anyway, so the
   * fallback applies.
   *
   * The matched route is a template (`/v1/notes/:id`), never the request path, so the bucket count
   * stays bounded by the number of routes.
   */
  function bucketFor(policy: ResolvedPolicy<Context>, context?: IHttpServerComponent.DefaultContext<Context>): string {
    if (policy.name !== undefined) return policy.name
    if (!context) return policy.fallbackBucket

    const routerPath = routeHandlerOf(context)
    // A router-level `use()` with no path mounts at the pattern `([^/]*)`, which is not a route — it
    // matches everything that router serves. Requiring a leading `/` keeps that case on the fallback
    // bucket, i.e. one allowance for the whole mount, which is what `router.use(limiter)` reads like.
    // Otherwise it would mint a bucket per method out of a regex, and that regex would then surface
    // in Redis keys and in the `bucket` metric label.
    if (!routerPath.startsWith('/')) return policy.fallbackBucket

    // The request method is deliberately NOT part of the bucket, even though a GET and a POST on one
    // path can cost very different amounts. The method is chosen by the caller, so including it can
    // only ever multiply an allowance: `HEAD` routes to a `GET` handler and executes it, which gave
    // every GET endpoint twice its limit, and a route registered for all methods gave it one limit per
    // method. A limiter must never loosen on caller input, and the two directions are not
    // symmetric — sharing a bucket is conservative, splitting one is a bypass.
    //
    // The policy is folded in instead, so two mounts on the same path with different limits still get
    // their own counters. Without that, a busy `GET /x` with a large `max` would fill the counter a
    // small `POST /x` limit reads from and throttle it on traffic that was never its own.
    const memoKey = `${routerPath} ${policy.fallbackBucket}`
    const memoized = bucketByRoute.get(memoKey)
    if (memoized !== undefined) return memoized

    // `:` separates the key's segments and a route template is full of it (`/v1/notes/:id`), so
    // parameters become a brace form that also reads better as a metric label. The trailing strip is
    // belt-and-braces for any colon a pattern might carry that is not a parameter.
    const template = routerPath.replace(/:([^/]+)/g, '{$1}').replace(/:/g, '')
    const bucket = `${template} ${policy.fallbackBucket}`
    bucketByRoute.set(memoKey, bucket)
    return bucket
  }

  function resolvePolicy(overrides?: RateLimitPolicyOptions<Context>): ResolvedPolicy<Context> {
    // Key-by-key rather than `{ ...options, ...overrides }`: a spread copies keys whose value is
    // `undefined`, so `withRateLimitMiddleware({ max: config.loginMax })` with an unset config field
    // would erase a component-wide `max` and silently fall through to the built-in default — a
    // loosening, not a tightening. The same spread would flip an operator's `failOpen: false` back
    // to `true`. Only a key that carries a real value overrides.
    const merged: RateLimitPolicyOptions<Context> = { ...options }
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) {
          ;(merged as Record<string, unknown>)[key] = value
        }
      }
    }

    const max = merged.max ?? DEFAULT_MAX
    const windowSeconds = merged.windowSeconds ?? DEFAULT_WINDOW_SECONDS
    const fallbackMaxDivisor = merged.fallbackMaxDivisor ?? DEFAULT_FALLBACK_MAX_DIVISOR

    assertPositiveInteger('max', max)
    assertPositiveInteger('windowSeconds', windowSeconds)
    assertPositiveInteger('fallbackMaxDivisor', fallbackMaxDivisor)
    // A window longer than a day is almost always a seconds/milliseconds mix-up — `windowSeconds:
    // 3_600_000` for an intended hour is a 41-day window otherwise accepted in silence. A daily
    // quota is legitimate, so the ceiling sits there; note that a mix-up landing *under* a day
    // (60_000 for an intended minute) is indistinguishable from a real 16.7-hour window by
    // magnitude and still passes.
    if (windowSeconds > MAX_WINDOW_SECONDS) {
      throw new InvalidRateLimitConfigurationError('windowSeconds', windowSeconds)
    }
    if (merged.disclosure !== undefined && !DISCLOSURE_LEVELS.has(merged.disclosure)) {
      throw new InvalidRateLimitConfigurationError('disclosure', merged.disclosure)
    }
    // The bucket sits between the prefix and the window id in the key, so a `:` inside it could
    // straddle those segments and make two different policies share one counter. The identity is
    // the final segment and is therefore free to contain `:`.
    if (merged.name !== undefined && (typeof merged.name !== 'string' || !VALID_BUCKET_NAME.test(merged.name))) {
      throw new InvalidRateLimitConfigurationError('name', merged.name)
    }

    return {
      // Deterministic, so every replica agrees on the bucket and it survives restarts.
      name: merged.name,
      fallbackBucket: merged.name ?? `${max}p${windowSeconds}`,
      max,
      windowMs: windowSeconds * 1000,
      fallbackMax: Math.max(1, Math.floor(max / fallbackMaxDivisor)),
      failOpen: merged.failOpen ?? true,
      disclosure: merged.disclosure ?? RateLimitDisclosure.RETRY_AFTER,
      skip: merged.skip,
      getKey: merged.getKey,
      onLimitExceeded: merged.onLimitExceeded,
      onStoreError: merged.onStoreError,
      buildLimitExceededResponse: merged.buildLimitExceededResponse
    }
  }

  const defaultPolicy = resolvePolicy()

  /**
   * Emits a metric, swallowing any failure.
   *
   * The metrics component throws for a metric it does not know — `Unknown metric …` — so a consumer
   * that forgot to register `metricDeclarations`, or a label that drifts from them, would otherwise
   * turn every allowed request into a `500` and make the fail-open path throw instead of serving.
   * Observability must never change a rate limit decision, which is the same rule the hooks follow.
   * The failure is logged on the store-error throttle so the misconfiguration is still discoverable.
   */
  function recordMetric(metric: keyof typeof metricDeclarations, labels: Record<string, string>): void {
    try {
      metrics.increment(metric, labels)
    } catch (error) {
      const now = Date.now()
      if (now - lastMetricErrorLoggedAt >= ADDRESS_ISSUE_LOG_INTERVAL_MS) {
        lastMetricErrorLoggedAt = now
        logger.warn(
          `Could not record the "${metric}" metric, so rate limit activity is not being reported. ` +
            'Register the exported metricDeclarations with your metrics component.',
          { error: isErrorWithMessage(error) ? error.message : 'Unknown error' }
        )
      }
    }
  }

  // Hooks are observability, never control flow: a failing metric must not change the response.
  async function runHook(hook: (() => void | Promise<void>) | undefined, name: string): Promise<void> {
    if (!hook) return
    try {
      await hook()
    } catch (error) {
      logger.error(`The ${name} hook threw and was ignored`, {
        error: isErrorWithMessage(error) ? error.message : 'Unknown error'
      })
    }
  }

  async function count(
    identity: string,
    policy: ResolvedPolicy<Context>,
    bucket: string,
    max: number,
    keySource: RateLimitKeySource,
    context?: IHttpServerComponent.DefaultContext<Context>
  ): Promise<RateLimitResult> {
    const now = Date.now()
    // Phase the window per identity, so this caller's boundary is not every caller's boundary. The
    // bucket is folded in as well, so the same caller does not hit all of its endpoints' boundaries
    // at the same instant either.
    const { windowId, resetAt } = currentWindow(
      now,
      policy.windowMs,
      windowOffsetFor(`${bucket}:${identity}`, policy.windowMs)
    )
    const secondsLeftInWindow = Math.ceil((resetAt - now) / 1000)
    const base = {
      limit: max,
      // Never 0: some clients read `Retry-After: 0` as "retry immediately", which is the retry storm
      // this header exists to prevent.
      retryAfterSeconds: Math.max(1, secondsLeftInWindow),
      resetAt,
      keySource,
      identity,
      bucket
    }

    const key = buildCounterKey(keyPrefix, bucket, windowId, encodeIdentity(identity, hashKeys))
    // The counter only has to outlive its own window: the next window uses a different key, so an
    // over-long TTL wastes a little memory but can never stretch a window, while an under-long one
    // would hand the caller a free reset mid-window.
    const ttlInSeconds = secondsLeftInWindow + COUNTER_TTL_GRACE_SECONDS

    let counted: number
    try {
      const result = await cache.increment(key, { ttlInSeconds })
      counted = result.value
    } catch (error) {
      // One failure per request during an outage would flood the log; the hook is unthrottled so a
      // metric still sees every one.
      if (now - lastStoreErrorLoggedAt >= STORE_ERROR_LOG_INTERVAL_MS) {
        lastStoreErrorLoggedAt = now
        logger.error(
          policy.failOpen
            ? 'The rate limit counter is unavailable; allowing requests until it recovers'
            : 'The rate limit counter is unavailable; rejecting requests until it recovers',
          // `failOpen` is logged because the throttle is shared across policies: without it, an
          // operator paged for a 429 spike on a fail-closed endpoint can read a line saying
          // "allowing requests" that was emitted for a different, fail-open one.
          {
            bucket,
            failOpen: String(policy.failOpen),
            error: isErrorWithMessage(error) ? error.message : 'Unknown error'
          }
        )
      }
      recordMetric('rate_limiter_store_errors_total', { bucket, fail_open: String(policy.failOpen) })
      await runHook(policy.onStoreError && (() => policy.onStoreError!(context, error)), 'onStoreError')

      return { ...base, allowed: policy.failOpen, remaining: 0, firstRejectionInWindow: false, storeUnavailable: true }
    }

    const allowed = counted <= max
    return {
      ...base,
      allowed,
      remaining: Math.max(0, max - counted),
      firstRejectionInWindow: !allowed && counted === max + 1,
      storeUnavailable: false
    }
  }

  /**
   * Precedence: the caller's `getKey`, then the configured trusted header, then the address of the
   * socket the request arrived on, then a shared bucket.
   */
  async function resolveIdentity(
    context: IHttpServerComponent.DefaultContext<Context>,
    policy: ResolvedPolicy<Context>,
    bucket: string
  ): Promise<{ identity: string; source: RateLimitKeySource }> {
    if (policy.getKey) {
      try {
        const custom = await policy.getKey(context)
        // `trim`, matching `consume`: a whitespace-only key is no more an identity than an empty one,
        // and accepting it here would hand every such caller one shared bucket at the FULL limit while
        // `consume` routes the same value to the tightened fallback.
        if (typeof custom === 'string' && custom.trim().length > 0) {
          return { identity: custom, source: RateLimitKeySource.CUSTOM }
        }
      } catch (error) {
        logger.error('The configured getKey threw; falling back to the client address', {
          error: isErrorWithMessage(error) ? error.message : 'Unknown error'
        })
      }
    }

    if (trustedClientIpHeader) {
      const rawHeader = context.request.headers.get(trustedClientIpHeader)
      const fromHeader = clientIpFromForwardedHeader(rawHeader, trustedProxyCount)
      if (fromHeader) return { identity: fromHeader, source: RateLimitKeySource.TRUSTED_HEADER }

      // A configured header that yields nothing is the loudest misconfiguration this component has,
      // and it used to be completely silent: behind a proxy the socket address below always succeeds,
      // so every client in the world collapses onto the proxy's address and the limit becomes a
      // global cap — a self-inflicted outage with nothing in the logs. Causes: the header was renamed,
      // the CDN was bypassed or removed, or `trustedProxyCount` no longer matches the real hop count.
      reportAddressIssue(
        rawHeader === null
          ? RateLimitAddressIssue.TRUSTED_HEADER_MISSING
          : RateLimitAddressIssue.TRUSTED_HEADER_UNUSABLE,
        bucket,
        rawHeader === null
          ? `The configured trustedClientIpHeader "${trustedClientIpHeader}" was not present on the request, so it is being keyed on the connecting address instead. ` +
              'Behind a proxy that is the proxy itself, which buckets every caller into one limit. ' +
              'Either the header name is wrong, or this request did not come through the proxy that sets it.'
          : `The configured trustedClientIpHeader "${trustedClientIpHeader}" held no usable address, so the request is being keyed on the connecting address instead. ` +
              'Behind a proxy that is the proxy itself, which buckets every caller into one limit. ' +
              `Check that trustedProxyCount (${trustedProxyCount}) matches the number of proxies that append to the header.`
      )
    }

    // Keying on the socket address is correct for a directly exposed service and wrong behind a proxy,
    // where it is the proxy's address and buckets every caller together. There is deliberately no
    // signal for the second case: the only way to detect it from a request is the presence of a
    // forwarding header, and a client can send one of those at will — which would let an outsider
    // trigger a warning, and inflate an alert-worthy counter at request rate, on a service that is
    // correctly configured. `key_source="socket"` dominating on a service believed to sit behind a
    // proxy is the same signal and cannot be forged, so it belongs on a dashboard instead.
    const socketAddress = canonicalizeIpAddress(context.remoteAddress)
    if (socketAddress) return { identity: socketAddress, source: RateLimitKeySource.SOCKET }

    reportAddressIssue(
      RateLimitAddressIssue.NO_CLIENT_ADDRESS,
      bucket,
      'No client address could be established, so every caller shares one rate limit bucket at a tightened cap. ' +
        'Check that this service runs behind a proxy setting the configured trustedClientIpHeader, or on a server that exposes the socket address.'
    )
    return { identity: FALLBACK_IDENTITY, source: RateLimitKeySource.FALLBACK }
  }

  function withRateLimitMiddleware(
    overrides?: RateLimitPolicyOptions<Context>
  ): IHttpServerComponent.IRequestHandler<Context> {
    // Resolved here rather than per request, so a bad limit fails when the middleware is built.
    const policy = overrides ? resolvePolicy(overrides) : defaultPolicy

    return async (context, next) => {
      if (policy.skip !== undefined && shouldSkip(context, policy.skip)) {
        return next()
      }

      const bucket = bucketFor(policy, context)
      const { identity, source } = await resolveIdentity(context, policy, bucket)
      // The shared bucket is a global quota, so it gets a tighter cap than a per-client one.
      const max = source === RateLimitKeySource.FALLBACK ? policy.fallbackMax : policy.max
      const result = await count(identity, policy, bucket, max, source, context)

      recordOutcome(result, routeHandlerOf(context))

      if (result.allowed) {
        const response = await next()
        // Not while the store is down: the counts are not real, and advertising `Remaining: 0` to a
        // client that honours the standard headers tells it to stop sending for the rest of the
        // window — the opposite of what failing open is for.
        return policy.disclosure === RateLimitDisclosure.ALWAYS && !result.storeUnavailable
          ? withRateLimitHeaders(response, result)
          : response
      }

      await runHook(policy.onLimitExceeded && (() => policy.onLimitExceeded!(context, result)), 'onLimitExceeded')

      // Falls back to the built-in `429` if the custom builder throws or returns nothing. It is the
      // only one of these callbacks that produces the response rather than observing it, so an
      // unguarded throw here escaped as a `500` with no `Retry-After` and the stack in the body —
      // contradicting the documented "a throwing hook never changes the response", hiding the
      // rejection from 429 dashboards, and inviting an immediate client retry.
      let response: IHttpServerComponent.IResponse | undefined
      if (policy.buildLimitExceededResponse) {
        try {
          response = await policy.buildLimitExceededResponse(context, result)
        } catch (error) {
          logger.error('The buildLimitExceededResponse hook threw; falling back to the default response', {
            error: isErrorWithMessage(error) ? error.message : 'Unknown error'
          })
        }
      }
      // At `NONE` even the body is withheld: a message naming the limit is disclosure too. A custom
      // builder still wins, since the component can suppress what it would add but not redact a body
      // the caller chose to write.
      response ??= tooManyRequestsResponse(policy.disclosure)

      if (policy.disclosure === RateLimitDisclosure.NONE) {
        return response
      }

      const withDelay = withRetryAfter(response, result)
      return policy.disclosure === RateLimitDisclosure.RETRY_AFTER
        ? withDelay
        : withRateLimitHeaders(withDelay, result)
    }
  }

  async function consume(identity: string, overrides?: RateLimitPolicyOptions<Context>): Promise<RateLimitResult> {
    if (typeof identity !== 'string') {
      throw new InvalidRateLimitConfigurationError('identity', identity)
    }
    const policy = overrides ? resolvePolicy(overrides) : defaultPolicy

    // An empty identity means the caller could not establish one — `consume(session.address ?? '')`.
    // Treating it as a normal key would give every anonymous caller one shared bucket at the FULL
    // limit, which is exactly backwards; route it the way the middleware routes a missing address.
    if (identity.trim().length === 0) {
      reportAddressIssue(
        RateLimitAddressIssue.NO_CLIENT_ADDRESS,
        bucketFor(policy),
        'consume() was called with an empty identity, so those calls share one bucket at a tightened cap. Pass a real identity to get per-caller limiting.'
      )
      const fallbackResult = await count(
        FALLBACK_IDENTITY,
        policy,
        bucketFor(policy),
        policy.fallbackMax,
        RateLimitKeySource.FALLBACK
      )
      recordOutcome(fallbackResult, '')
      return fallbackResult
    }

    const result = await count(identity, policy, bucketFor(policy), policy.max, RateLimitKeySource.CUSTOM)
    recordOutcome(result, '')
    return result
  }

  /**
   * Reports the decision as a counter rather than a log line. `handler` is the matched route template,
   * so an endpoint being throttled is visible without the request path — which would be unbounded as a
   * label and would carry ids.
   */
  function recordOutcome(result: RateLimitResult, handler: string): void {
    const outcome = result.storeUnavailable
      ? RateLimitOutcome.DEGRADED
      : result.allowed
        ? RateLimitOutcome.ALLOWED
        : RateLimitOutcome.LIMITED

    recordMetric('rate_limiter_requests_total', {
      bucket: result.bucket,
      handler,
      outcome,
      key_source: result.keySource
    })
  }

  return { consume, withRateLimitMiddleware }
}

/**
 * The matched route template for the `handler` metric label, e.g. `/v1/notes/:id`.
 *
 * The router puts it on the context; a middleware mounted with `server.use()` runs before any route
 * matched, so it is empty there. Deliberately never the raw pathname: ids in a path would create an
 * unbounded number of Prometheus series.
 */
function routeHandlerOf(context: IHttpServerComponent.DefaultContext<object>): string {
  const routed = context as { routerPath?: unknown }
  return typeof routed.routerPath === 'string' ? routed.routerPath : ''
}

// The retry delay travels in `Retry-After` only, never in the body: one authoritative place for it
// means a client cannot read a stale or contradicting value out of the payload.
//
// At `NONE` the body is omitted entirely. `Too many requests` tells a caller its rejection was a rate
// limit rather than anything else, which is exactly what that level exists to withhold.
function tooManyRequestsResponse(disclosure: RateLimitDisclosure): IHttpServerComponent.IResponse {
  if (disclosure === RateLimitDisclosure.NONE) {
    return { status: 429 }
  }
  return {
    status: 429,
    body: { ok: false, message: 'Too many requests' }
  }
}

// A `Response` from another realm or another implementation (node-fetch, a second copy of undici)
// fails `instanceof` while still keeping `status`/`body` on its prototype, so spreading it would
// serve a bodiless `200` — the exact failure the branch below exists to avoid. Duck-typing on the
// mutable-headers-plus-`clone` shape catches those; a plain `IResponse` object literal has neither.
function isResponseLike(response: unknown): response is Response {
  if (response instanceof Response) return true
  const candidate = response as { headers?: { set?: unknown }; clone?: unknown } | null
  return typeof candidate?.clone === 'function' && typeof candidate?.headers?.set === 'function'
}

/**
 * Merges headers into a response **without spreading it**. A handler is allowed to return a native
 * `Response`, whose `status`/`body` are prototype getters — `{ ...response }` would silently drop
 * them and serve a bodiless `200`, the exact bug `fromNativeResponse` exists to prevent. Headers on
 * a `Response` obtained from `fetch` are immutable, so setting one throws; a rate limit header is
 * not worth a `500`, so that case is skipped.
 */
function withHeaders(
  response: IHttpServerComponent.IResponse,
  headers: Record<string, string>,
  overwrite: boolean
): IHttpServerComponent.IResponse {
  // A handler is allowed to return nothing; the server turns that into a `501` of its own. Reading
  // `.headers` off it here would raise a `TypeError` and regress that to a `500`.
  if (response === null || response === undefined) return response

  if (isResponseLike(response)) {
    try {
      for (const [name, value] of Object.entries(headers)) {
        if (overwrite || !response.headers.has(name)) response.headers.set(name, value)
      }
    } catch {
      // Immutable header guard; leave the response as it is.
    }
    return response
  }

  const merged = new Headers(response.headers)
  for (const [name, value] of Object.entries(headers)) {
    if (overwrite || !merged.has(name)) merged.set(name, value)
  }
  return { ...response, headers: merged }
}

/** Never overwrites: a custom `buildLimitExceededResponse` may have chosen its own delay. */
function withRetryAfter(response: IHttpServerComponent.IResponse, result: RateLimitResult) {
  return withHeaders(response, { 'Retry-After': result.retryAfterSeconds.toString() }, false)
}

function withRateLimitHeaders(response: IHttpServerComponent.IResponse, result: RateLimitResult) {
  return withHeaders(
    response,
    {
      'RateLimit-Limit': result.limit.toString(),
      'RateLimit-Remaining': result.remaining.toString(),
      // Seconds until the window resets, NOT an absolute timestamp. The name is the standardized
      // one, whose defined value is delta-seconds, so epoch seconds here would read as a backoff of
      // tens of thousands of years to a compliant client. It duplicates `Retry-After`, which is what
      // the spec intends; `result.resetAt` carries the absolute instant for hooks that want it.
      'RateLimit-Reset': result.retryAfterSeconds.toString()
    },
    true
  )
}
