import { isIP } from 'net'
import { createHash } from 'crypto'
import { isErrorWithMessage, type IHttpServerComponent } from '@dcl/core-commons'
import { CacheIncrementUnsupportedError, InvalidRateLimitConfigurationError } from './errors'
import {
  IRateLimiterComponent,
  RateLimiterComponents,
  RateLimiterOptions,
  RateLimitHeaderMode,
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

// A store outage produces one failure per request; log at most this often instead.
const STORE_ERROR_LOG_INTERVAL_MS = 10_000

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
  const candidate = stripPort(value.trim())
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

  const hops = value
    .split(',')
    .map(hop => hop.trim())
    .filter(hop => hop.length > 0)

  const index = hops.length - trustedProxyCount
  if (index < 0) return null

  return canonicalizeIpAddress(hops[index])
}

/** Deterministic, epoch-aligned window boundaries. See the README note on the 2x boundary burst. */
export function currentWindow(now: number, windowMs: number): { windowId: number; resetAt: number } {
  const windowId = Math.floor(now / windowMs)
  return { windowId, resetAt: (windowId + 1) * windowMs }
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
  if (!hashKeys && identity.length <= MAX_RAW_IDENTITY_LENGTH) return identity
  return createHash('sha256').update(identity).digest('hex').slice(0, 32)
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

type ResolvedPolicy = Required<Pick<RateLimitPolicyOptions, 'max' | 'failOpen' | 'emitRateLimitHeaders'>> &
  Pick<
    RateLimitPolicyOptions,
    'skip' | 'getKey' | 'onLimitExceeded' | 'onStoreError' | 'buildLimitExceededResponse'
  > & {
    bucket: string
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
export function createRateLimiterComponent(
  components: RateLimiterComponents,
  options: RateLimiterOptions = {}
): IRateLimiterComponent {
  const { cache, logs } = components
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

  const trustedClientIpHeader = options.trustedClientIpHeader?.toLowerCase()
  const trustedProxyCount = options.trustedProxyCount ?? DEFAULT_TRUSTED_PROXY_COUNT
  assertPositiveInteger('trustedProxyCount', trustedProxyCount)
  const hashKeys = options.hashKeys ?? false

  // Scoped to this instance rather than the module, so a service running several limiters with
  // different key configs hears about each one — and so tests need no reset hatch in production code.
  let warnedAboutMissingClientAddress = false
  let lastStoreErrorLoggedAt = 0

  function resolvePolicy(overrides?: RateLimitPolicyOptions): ResolvedPolicy {
    const merged = { ...options, ...overrides }
    const max = merged.max ?? DEFAULT_MAX
    const windowSeconds = merged.windowSeconds ?? DEFAULT_WINDOW_SECONDS
    const fallbackMaxDivisor = merged.fallbackMaxDivisor ?? DEFAULT_FALLBACK_MAX_DIVISOR

    assertPositiveInteger('max', max)
    assertPositiveInteger('windowSeconds', windowSeconds)
    assertPositiveInteger('fallbackMaxDivisor', fallbackMaxDivisor)

    return {
      // Deterministic, so every replica agrees on the bucket and it survives restarts.
      bucket: merged.name ?? `${max}p${windowSeconds}`,
      max,
      windowMs: windowSeconds * 1000,
      fallbackMax: Math.max(1, Math.floor(max / fallbackMaxDivisor)),
      failOpen: merged.failOpen ?? true,
      emitRateLimitHeaders: merged.emitRateLimitHeaders ?? RateLimitHeaderMode.ON_LIMIT,
      skip: merged.skip,
      getKey: merged.getKey,
      onLimitExceeded: merged.onLimitExceeded,
      onStoreError: merged.onStoreError,
      buildLimitExceededResponse: merged.buildLimitExceededResponse
    }
  }

  const defaultPolicy = resolvePolicy()

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
    policy: ResolvedPolicy,
    max: number,
    keySource: RateLimitKeySource,
    context?: IHttpServerComponent.DefaultContext<object>
  ): Promise<RateLimitResult> {
    const now = Date.now()
    const { windowId, resetAt } = currentWindow(now, policy.windowMs)
    const secondsLeftInWindow = Math.ceil((resetAt - now) / 1000)
    const base = {
      limit: max,
      // Never 0: some clients read `Retry-After: 0` as "retry immediately", which is the retry storm
      // this header exists to prevent.
      retryAfterSeconds: Math.max(1, secondsLeftInWindow),
      resetAt,
      keySource,
      identity,
      bucket: policy.bucket
    }

    const key = buildCounterKey(keyPrefix, policy.bucket, windowId, encodeIdentity(identity, hashKeys))
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
          { bucket: policy.bucket, error: isErrorWithMessage(error) ? error.message : 'Unknown error' }
        )
      }
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
    context: IHttpServerComponent.DefaultContext<object>,
    policy: ResolvedPolicy
  ): Promise<{ identity: string; source: RateLimitKeySource }> {
    if (policy.getKey) {
      try {
        const custom = await policy.getKey(context)
        if (typeof custom === 'string' && custom.length > 0) {
          return { identity: custom, source: RateLimitKeySource.CUSTOM }
        }
      } catch (error) {
        logger.error('The configured getKey threw; falling back to the client address', {
          error: isErrorWithMessage(error) ? error.message : 'Unknown error'
        })
      }
    }

    if (trustedClientIpHeader) {
      const fromHeader = clientIpFromForwardedHeader(
        context.request.headers.get(trustedClientIpHeader),
        trustedProxyCount
      )
      if (fromHeader) return { identity: fromHeader, source: RateLimitKeySource.TRUSTED_HEADER }
    }

    const socketAddress = canonicalizeIpAddress(context.remoteAddress)
    if (socketAddress) return { identity: socketAddress, source: RateLimitKeySource.SOCKET }

    if (!warnedAboutMissingClientAddress) {
      warnedAboutMissingClientAddress = true
      logger.warn(
        'No client address could be established, so every caller shares one rate limit bucket at a tightened cap. ' +
          'Check that this service runs behind a proxy setting the configured trustedClientIpHeader, or on a server that exposes the socket address.'
      )
    }
    return { identity: FALLBACK_IDENTITY, source: RateLimitKeySource.FALLBACK }
  }

  function withRateLimitMiddleware<Context extends object = {}>(
    overrides?: RateLimitPolicyOptions
  ): IHttpServerComponent.IRequestHandler<Context> {
    // Resolved here rather than per request, so a bad limit fails when the middleware is built.
    const policy = overrides ? resolvePolicy(overrides) : defaultPolicy

    return async (context, next) => {
      if (policy.skip !== undefined && shouldSkip(context, policy.skip)) {
        return next()
      }

      const { identity, source } = await resolveIdentity(context, policy)
      // The shared bucket is a global quota, so it gets a tighter cap than a per-client one.
      const max = source === RateLimitKeySource.FALLBACK ? policy.fallbackMax : policy.max
      const result = await count(identity, policy, max, source, context)

      if (result.allowed) {
        const response = await next()
        return policy.emitRateLimitHeaders === RateLimitHeaderMode.ALWAYS
          ? withRateLimitHeaders(response, result)
          : response
      }

      // Once per bucket per window: a caller that keeps retrying while throttled would otherwise
      // write a line per request.
      if (result.firstRejectionInWindow) {
        logger.warn('Request rejected by the rate limiter', {
          bucket: result.bucket,
          keySource: result.keySource,
          limit: result.limit,
          retryAfterSeconds: result.retryAfterSeconds
        })
      }
      await runHook(policy.onLimitExceeded && (() => policy.onLimitExceeded!(context, result)), 'onLimitExceeded')

      const response = policy.buildLimitExceededResponse
        ? await policy.buildLimitExceededResponse(context, result)
        : tooManyRequestsResponse(result)

      return policy.emitRateLimitHeaders === RateLimitHeaderMode.NEVER
        ? withRetryAfter(response, result)
        : withRateLimitHeaders(withRetryAfter(response, result), result)
    }
  }

  async function consume(identity: string, overrides?: RateLimitPolicyOptions): Promise<RateLimitResult> {
    const policy = overrides ? resolvePolicy(overrides) : defaultPolicy
    return count(identity, policy, policy.max, RateLimitKeySource.CUSTOM)
  }

  return { consume, withRateLimitMiddleware }
}

function tooManyRequestsResponse(result: RateLimitResult): IHttpServerComponent.IResponse {
  return {
    status: 429,
    body: { ok: false, message: `Too many requests. Retry in ${result.retryAfterSeconds} seconds.` }
  }
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
  if (response instanceof Response) {
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
      // Absolute Unix seconds. The other reading of `Reset` — seconds remaining — would just
      // duplicate `Retry-After`, so the absolute one is what adds information.
      'RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString()
    },
    true
  )
}
