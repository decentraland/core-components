import { ILoggerComponent } from '@well-known-components/interfaces'
import { IHttpServerComponent, IncrementOptions, IncrementResult } from '@dcl/core-commons'
import {
  assertPositiveInteger,
  buildCounterKey,
  canonicalizeIpAddress,
  clientIpFromForwardedHeader,
  createRateLimiterComponent,
  currentWindow,
  encodeIdentity,
  FALLBACK_IDENTITY,
  windowOffsetFor,
  MAX_RAW_IDENTITY_LENGTH,
  shouldSkip
} from '../src/component'
import { CacheIncrementUnsupportedError, InvalidRateLimitConfigurationError } from '../src/errors'
import {
  IRateLimiterComponent,
  RateLimiterComponents,
  RateLimiterOptions,
  RateLimitDisclosure,
  RateLimitKeySource,
  RateLimitPolicyOptions,
  RateLimitResult,
  RateLimitSkipper
} from '../src/types'
import { RateLimitAddressIssue, RateLimitOutcome } from '../src/metrics'

type Middleware = IHttpServerComponent.IRequestHandler<object>

/**
 * A stand-in for a real cache: counters keyed exactly as the component writes them, with the
 * TTL-on-create rule the interface promises. Lets the keying and rollover assertions run without
 * timers or a live store.
 */
function createFakeCache() {
  const counters = new Map<string, { value: number; expiresAt: number }>()

  return {
    counters,
    increment: jest.fn(async (key: string, options?: IncrementOptions): Promise<IncrementResult> => {
      const now = Date.now()
      const existing = counters.get(key)
      const alive = existing && existing.expiresAt > now ? existing : undefined
      const value = (alive?.value ?? 0) + (options?.amount ?? 1)
      const expiresAt = alive?.expiresAt ?? now + (options?.ttlInSeconds ?? 60) * 1000
      counters.set(key, { value, expiresAt })
      return { value, ttlRemainingInMilliseconds: expiresAt - now }
    })
  }
}

function createFakeMetrics() {
  return {
    increment: jest.fn(),
    decrement: jest.fn(),
    observe: jest.fn(),
    startTimer: jest.fn().mockReturnValue({ end: jest.fn() }),
    reset: jest.fn(),
    resetAll: jest.fn()
  }
}

let cache: ReturnType<typeof createFakeCache>
let metrics: ReturnType<typeof createFakeMetrics>
let warnMock: jest.Mock
let errorMock: jest.Mock
let logs: ILoggerComponent
let components: RateLimiterComponents
let options: RateLimiterOptions
let context: IHttpServerComponent.DefaultContext<object>
let next: jest.Mock
let downstreamResponse: IHttpServerComponent.IResponse
let middleware: Middleware
let limiter: IRateLimiterComponent
let response: IHttpServerComponent.IResponse
let result: RateLimitResult

function createContext(
  overrides: { pathname?: string; headers?: Record<string, string>; remoteAddress?: string | undefined } = {}
): IHttpServerComponent.DefaultContext<object> {
  const { pathname = '/v1/notes', headers } = overrides
  // Key presence, not a destructuring default: passing `remoteAddress: undefined` explicitly must
  // mean "no socket address", which a default parameter would silently overwrite.
  const remoteAddress = 'remoteAddress' in overrides ? overrides.remoteAddress : '203.0.113.7'
  const url = new URL(`http://rate-limiter.test${pathname}`)
  return {
    request: new Request(url.toString(), { headers }),
    url,
    remoteAddress
  }
}

async function callTimes(times: number, mw: Middleware = middleware, ctx = context) {
  const responses: IHttpServerComponent.IResponse[] = []
  for (let i = 0; i < times; i++) {
    responses.push(await mw(ctx, next))
  }
  return responses
}

// Any instant will do; it only has to be fixed.
const FROZEN_NOW = new Date('2026-08-13T10:00:00.000Z')

beforeEach(() => {
  // Freeze the clock. Window boundaries are real instants derived from `Date.now()`, so on a live
  // clock one can fall between two requests of the same test — the next request then starts a fresh
  // window and is allowed where the test expects a `429`. It is rare per run but reachable, and
  // frozen time removes the whole class rather than narrowing it: every request in a test lands in
  // the same window by construction. Tests that need a rollover move the clock deliberately.
  jest.useFakeTimers({ now: FROZEN_NOW })

  cache = createFakeCache()
  metrics = createFakeMetrics()
  warnMock = jest.fn()
  errorMock = jest.fn()
  logs = {
    getLogger: () => ({
      info: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
      warn: warnMock,
      error: errorMock
    })
  }
  components = { cache, logs, metrics: metrics as unknown as RateLimiterComponents['metrics'] }
  options = { keyPrefix: 'svc:rl', max: 3, windowSeconds: 60 }
  context = createContext()
  downstreamResponse = { status: 200, body: { ok: true } }
  next = jest.fn().mockResolvedValue(downstreamResponse)
})

afterEach(() => {
  jest.useRealTimers()
})

describe('when the request count is under the limit', () => {
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    response = await middleware(context, next)
  })

  it('should call the next middleware', () => {
    expect(next).toHaveBeenCalled()
  })

  it('should return the downstream response unchanged', () => {
    expect(response).toEqual(downstreamResponse)
  })

  it('should count the request under a key namespaced with the prefix, bucket and canonical address', () => {
    expect(cache.increment).toHaveBeenCalledWith(expect.stringMatching(/^svc:rl:3p60:\d+:r:203\.0\.113\.7$/), {
      ttlInSeconds: expect.any(Number)
    })
  })
})

describe('when the request count reaches the limit exactly', () => {
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    response = (await callTimes(3))[2]
  })

  it('should still call the next middleware for every request', () => {
    expect(next).toHaveBeenCalledTimes(3)
  })

  it('should return the downstream response', () => {
    expect(response).toEqual(downstreamResponse)
  })
})

describe('when the request count exceeds the limit', () => {
  let headers: Headers

  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    response = (await callTimes(4))[3]
    headers = new Headers(response.headers)
  })

  it('should respond with a too many requests status', () => {
    expect(response.status).toBe(429)
  })

  it('should not call the next middleware for the rejected request', () => {
    expect(next).toHaveBeenCalledTimes(3)
  })

  it('should set Retry-After to the seconds left in the window', () => {
    expect(Number(new Headers(response.headers).get('Retry-After'))).toBeGreaterThan(0)
  })

  it('should respond with a body that does not restate the retry delay', () => {
    expect(response.body).toEqual({ ok: false, message: 'Too many requests' })
  })

  it('should not disclose the limit or the remaining budget by default', () => {
    expect(headers.get('RateLimit-Limit')).toBeNull()
    expect(headers.get('RateLimit-Remaining')).toBeNull()
    expect(headers.get('RateLimit-Reset')).toBeNull()
  })

  it('should count the rejection as a metric rather than writing a log line', () => {
    expect(metrics.increment).toHaveBeenCalledWith('rate_limiter_requests_total', {
      bucket: '3p60',
      handler: '',
      outcome: RateLimitOutcome.LIMITED,
      key_source: RateLimitKeySource.SOCKET
    })
  })

  it('should not log the rejection, since a throttled caller retries and would amplify the writes', () => {
    expect(warnMock).not.toHaveBeenCalled()
    expect(errorMock).not.toHaveBeenCalled()
  })

  it('should count the allowed requests too, so a rejection rate is computable', () => {
    expect(metrics.increment).toHaveBeenCalledWith(
      'rate_limiter_requests_total',
      expect.objectContaining({ outcome: RateLimitOutcome.ALLOWED })
    )
  })

  describe('and further requests in the same window are rejected', () => {
    beforeEach(async () => {
      await middleware(context, next)
    })

    it('should count each one rather than deduplicating like a log would', () => {
      const limited = metrics.increment.mock.calls.filter(
        call => call[0] === 'rate_limiter_requests_total' && call[1]?.outcome === RateLimitOutcome.LIMITED
      )
      expect(limited).toHaveLength(2)
    })
  })
})

describe('when an onLimitExceeded hook is configured', () => {
  let onLimitExceeded: jest.Mock

  beforeEach(async () => {
    onLimitExceeded = jest.fn()
    middleware = createRateLimiterComponent(components, { ...options, onLimitExceeded }).withRateLimitMiddleware()
    response = (await callTimes(4))[3]
  })

  it('should invoke it with the context and the result', () => {
    expect(onLimitExceeded).toHaveBeenCalledWith(context, expect.objectContaining({ allowed: false, limit: 3 }))
  })

  describe('and the hook throws', () => {
    beforeEach(async () => {
      onLimitExceeded.mockRejectedValueOnce(new Error('metrics down'))
      response = await middleware(context, next)
    })

    it('should still respond with a too many requests status', () => {
      expect(response.status).toBe(429)
    })

    it('should log the hook failure instead of propagating it', () => {
      expect(errorMock).toHaveBeenCalledWith(
        'The onLimitExceeded hook threw and was ignored',
        expect.objectContaining({ error: 'metrics down' })
      )
    })
  })
})

describe('when a custom limit exceeded response is configured', () => {
  describe('and it omits Retry-After', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        buildLimitExceededResponse: () => ({ status: 429, body: { error: 'slow down' } })
      }).withRateLimitMiddleware()
      response = (await callTimes(4))[3]
    })

    it('should return that response body', () => {
      expect(response.body).toEqual({ error: 'slow down' })
    })

    it('should add Retry-After so a custom response cannot accidentally omit it', () => {
      expect(new Headers(response.headers).get('Retry-After')).toEqual(expect.any(String))
    })
  })

  describe('and it sets its own Retry-After', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        buildLimitExceededResponse: () => ({ status: 429, headers: { 'Retry-After': '999' } })
      }).withRateLimitMiddleware()
      response = (await callTimes(4))[3]
    })

    it('should keep the custom delay', () => {
      expect(new Headers(response.headers).get('Retry-After')).toBe('999')
    })
  })
})

describe('when the window rolls over', () => {
  let keys: string[]
  let lastKey: string

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T10:00:00.000Z'))
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await callTimes(4)
    jest.setSystemTime(new Date('2026-08-13T10:01:00.000Z'))
    response = await middleware(context, next)
    keys = cache.increment.mock.calls.map(call => call[0] as string)
    lastKey = keys[keys.length - 1]
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should allow a caller that was rejected in the previous window', () => {
    expect(response).toEqual(downstreamResponse)
  })

  it('should count the first request of the new window under a different key', () => {
    expect(new Set(keys).size).toBe(2)
  })

  it('should restart the count at one', () => {
    expect(cache.counters.get(lastKey)?.value).toBe(1)
  })
})

describe('when the counter is created', () => {
  let requestedTtl: number
  let millisecondsLeftInWindow: number

  beforeEach(async () => {
    const now = new Date('2026-08-13T10:00:30.400Z')
    jest.useFakeTimers().setSystemTime(now)
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await middleware(context, next)
    requestedTtl = (cache.increment.mock.calls[0][1] as { ttlInSeconds: number }).ttlInSeconds
    // Windows are phased per identity, so the remaining time is derived rather than assumed. The
    // helpers doing the deriving are unit-tested separately, just below.
    // The component phases on `bucket:identity`, with the identity raw rather than key-encoded.
    const { resetAt } = currentWindow(now.getTime(), 60_000, windowOffsetFor('3p60:203.0.113.7', 60_000))
    millisecondsLeftInWindow = resetAt - now.getTime()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should never ask for less than the window has left, which would hand out a free reset', () => {
    expect(requestedTtl * 1000).toBeGreaterThanOrEqual(millisecondsLeftInWindow)
  })

  it('should never ask for much more than a window, so a counter cannot outlive its successor', () => {
    expect(requestedTtl).toBeLessThanOrEqual(61)
  })

  it('should round the remaining window up rather than down, plus a grace second', () => {
    expect(requestedTtl).toBe(Math.ceil(millisecondsLeftInWindow / 1000) + 1)
  })
})

describe('when deriving a window offset for an identity', () => {
  it('should stay inside the window', () => {
    for (const identity of ['203.0.113.7', 'address:0xabc', 'unidentified-client']) {
      const offset = windowOffsetFor(identity, 60_000)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(60_000)
    }
  })

  it('should be stable for the same identity, so replicas agree without coordinating', () => {
    expect(windowOffsetFor('203.0.113.7', 60_000)).toBe(windowOffsetFor('203.0.113.7', 60_000))
  })

  it('should differ between identities, so one caller cannot infer another boundary', () => {
    expect(windowOffsetFor('203.0.113.7', 60_000)).not.toBe(windowOffsetFor('198.51.100.4', 60_000))
  })
})

describe('when two identities are limited over the same window length', () => {
  let resetInstants: number[]

  beforeEach(() => {
    const now = new Date('2026-08-13T10:00:00.000Z').getTime()
    resetInstants = ['203.0.113.7', '198.51.100.4', 'address:0xabc'].map(
      identity => currentWindow(now, 60_000, windowOffsetFor(identity, 60_000)).resetAt
    )
  })

  it('should not share a reset instant, removing the fleet-wide synchronised edge', () => {
    expect(new Set(resetInstants).size).toBe(resetInstants.length)
  })

  it('should still reset within one window of now, so the phase only shifts the boundary', () => {
    const now = new Date('2026-08-13T10:00:00.000Z').getTime()
    for (const resetAt of resetInstants) {
      expect(resetAt).toBeGreaterThan(now)
      expect(resetAt).toBeLessThanOrEqual(now + 60_000)
    }
  })
})

describe('when the store throws', () => {
  beforeEach(() => {
    cache.increment.mockRejectedValue(new Error('redis down'))
  })

  describe('and the limiter fails open', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      response = await middleware(context, next)
    })

    it('should call the next middleware', () => {
      expect(next).toHaveBeenCalled()
    })

    it('should return the downstream response', () => {
      expect(response).toEqual(downstreamResponse)
    })

    it('should log that it is allowing requests until the counter recovers', () => {
      expect(errorMock).toHaveBeenCalledWith(
        'The rate limit counter is unavailable; allowing requests until it recovers',
        expect.objectContaining({ error: 'redis down' })
      )
    })
  })

  describe('and the limiter fails closed', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, { ...options, failOpen: false }).withRateLimitMiddleware()
      response = await middleware(context, next)
    })

    it('should respond with a too many requests status', () => {
      expect(response.status).toBe(429)
    })

    it('should not call the next middleware', () => {
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('and it keeps failing within the log interval', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      await callTimes(5)
    })

    it('should log once instead of flooding', () => {
      expect(errorMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and an onStoreError hook is configured', () => {
    let onStoreError: jest.Mock

    beforeEach(async () => {
      onStoreError = jest.fn()
      middleware = createRateLimiterComponent(components, { ...options, onStoreError }).withRateLimitMiddleware()
      await callTimes(3)
    })

    it('should invoke it for every failure so the silent fail-open stays visible', () => {
      expect(onStoreError).toHaveBeenCalledTimes(3)
    })
  })
})

describe('when no client address can be established', () => {
  let responses: IHttpServerComponent.IResponse[]

  beforeEach(async () => {
    context = createContext({ remoteAddress: undefined })
    middleware = createRateLimiterComponent(components, { ...options, max: 100 }).withRateLimitMiddleware()
    responses = await callTimes(11)
  })

  it('should count against the shared fallback bucket', () => {
    expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining(FALLBACK_IDENTITY), expect.anything())
  })

  it('should apply the tightened cap rather than the full limit', () => {
    expect(responses[9].status).not.toBe(429)
    expect(responses[10].status).toBe(429)
  })

  it('should log about the shared bucket once, however many requests arrive', () => {
    const sharedBucketWarnings = warnMock.mock.calls.filter(call =>
      String(call[0]).includes('every caller shares one rate limit bucket')
    )
    expect(sharedBucketWarnings).toHaveLength(1)
  })

  describe('and the fallback divisor is disabled', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        max: 100,
        fallbackMaxDivisor: 1
      }).withRateLimitMiddleware()
      responses = await callTimes(11)
    })

    it('should apply the full limit', () => {
      expect(responses[10].status).not.toBe(429)
    })
  })

  describe('and the configured limit is smaller than the fallback divisor', () => {
    beforeEach(async () => {
      // `max: 3` with the default divisor of 10 floors to zero; without the `Math.max(1, …)` floor
      // every fallback request would be rejected forever, since no count is ever `<= 0`.
      middleware = createRateLimiterComponent(components, { ...options, max: 3 }).withRateLimitMiddleware()
      responses = await callTimes(2)
    })

    it('should still allow one request rather than rejecting everything', () => {
      expect(responses[0].status).not.toBe(429)
      expect(responses[1].status).toBe(429)
    })
  })
})

describe('when a trusted client IP header is configured', () => {
  beforeEach(() => {
    options = { ...options, trustedClientIpHeader: 'x-forwarded-for' }
  })

  describe('and it holds an address', () => {
    beforeEach(async () => {
      context = createContext({ headers: { 'x-forwarded-for': '198.51.100.4' } })
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      await middleware(context, next)
    })

    it('should key on the header rather than the socket address', () => {
      expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('198.51.100.4'), expect.anything())
    })
  })

  describe('and a client-spoofed entry precedes the proxy-appended one', () => {
    beforeEach(async () => {
      context = createContext({ headers: { 'x-forwarded-for': '1.1.1.1, 198.51.100.4' } })
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      await middleware(context, next)
    })

    it('should key on the proxy-appended entry so the header cannot be forged', () => {
      expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('198.51.100.4'), expect.anything())
    })
  })

  describe('and it is absent', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      await middleware(context, next)
    })

    it('should fall back to the socket address', () => {
      expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('203.0.113.7'), expect.anything())
    })
  })

  describe('and it holds a value that is not an address', () => {
    beforeEach(async () => {
      context = createContext({ headers: { 'x-forwarded-for': 'not-an-address' } })
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      await middleware(context, next)
    })

    it('should fall back to the socket address instead of minting a bucket from the garbage', () => {
      expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('203.0.113.7'), expect.anything())
    })
  })

  describe('and two requests carry the same address in different IPv6 spellings', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      await middleware(createContext({ headers: { 'x-forwarded-for': '2001:0DB8:0000::0001' } }), next)
      await middleware(createContext({ headers: { 'x-forwarded-for': '2001:db8::1' } }), next)
    })

    it('should count both against one bucket', () => {
      expect(new Set(cache.increment.mock.calls.map(call => call[0])).size).toBe(1)
    })
  })
})

describe('when a getKey function is configured', () => {
  describe('and it returns a key', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        getKey: () => 'address:0xabc'
      }).withRateLimitMiddleware()
      await middleware(context, next)
    })

    it('should count against that key', () => {
      expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('address:0xabc'), expect.anything())
    })
  })

  describe('and it returns undefined', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        getKey: () => undefined
      }).withRateLimitMiddleware()
      await middleware(context, next)
    })

    it('should fall through to the client address', () => {
      expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('203.0.113.7'), expect.anything())
    })
  })

  describe('and it throws', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        getKey: () => {
          throw new Error('lookup failed')
        }
      }).withRateLimitMiddleware()
      response = await middleware(context, next)
    })

    it('should fall through to the client address rather than failing the request', () => {
      expect(response).toEqual(downstreamResponse)
      expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('203.0.113.7'), expect.anything())
    })

    it('should log the failure', () => {
      expect(errorMock).toHaveBeenCalledWith(
        'The configured getKey threw; falling back to the client address',
        expect.objectContaining({ error: 'lookup failed' })
      )
    })
  })

  describe('and it returns a key longer than the raw cap', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        getKey: () => 'x'.repeat(200)
      }).withRateLimitMiddleware()
      await middleware(context, next)
    })

    it('should store a digest so an oversized value cannot become an oversized key', () => {
      expect(cache.increment).toHaveBeenCalledWith(expect.stringMatching(/:[0-9a-f]{32}$/), expect.anything())
    })
  })
})

describe('when a skip predicate is configured', () => {
  const skippers: [string, RateLimitSkipper][] = [
    ['a string', '/health/live'],
    ['an array of strings', ['/health/live']],
    ['a regular expression', /^\/health\//],
    ['a function', (request: IHttpServerComponent.IRequest) => new URL(request.url).pathname.startsWith('/health/')]
  ]

  describe.each(skippers)('and it is %s', (_label, skip) => {
    beforeEach(async () => {
      context = createContext({ pathname: '/health/live' })
      middleware = createRateLimiterComponent(components, { ...options, skip }).withRateLimitMiddleware()
      response = await middleware(context, next)
    })

    it('should not touch the store', () => {
      expect(cache.increment).not.toHaveBeenCalled()
    })

    it('should call the next middleware', () => {
      expect(next).toHaveBeenCalled()
    })
  })
})

describe('when two middlewares built from the same limiter use different overrides', () => {
  let loginMiddleware: Middleware
  let notesMiddleware: Middleware
  let keys: string[]

  beforeEach(async () => {
    limiter = createRateLimiterComponent(components, options)
    loginMiddleware = limiter.withRateLimitMiddleware({ name: 'login', max: 1 })
    notesMiddleware = limiter.withRateLimitMiddleware({ name: 'notes', max: 5 })
    await loginMiddleware(context, next)
    await notesMiddleware(context, next)
    keys = cache.increment.mock.calls.map(call => call[0] as string)
  })

  it('should count each against its own bucket', () => {
    expect(keys[0]).toContain(':login:')
    expect(keys[1]).toContain(':notes:')
  })

  describe('and one of the two limits is exhausted', () => {
    beforeEach(async () => {
      await callTimes(2, loginMiddleware)
      response = await notesMiddleware(context, next)
    })

    it('should still allow the other endpoint', () => {
      expect(response.status).not.toBe(429)
    })
  })

  describe('and neither middleware is named while both resolve to the same limit', () => {
    beforeEach(async () => {
      cache.increment.mockClear()
      loginMiddleware = limiter.withRateLimitMiddleware({ max: 4, windowSeconds: 60 })
      notesMiddleware = limiter.withRateLimitMiddleware({ max: 4, windowSeconds: 60 })
      await loginMiddleware(context, next)
      await notesMiddleware(context, next)
      keys = cache.increment.mock.calls.map(call => call[0] as string)
    })

    it('should count both against one counter, which is the documented double-count footgun', () => {
      expect(new Set(keys).size).toBe(1)
    })
  })
})

describe('when two limiters share a store under different key prefixes', () => {
  beforeEach(async () => {
    const first = createRateLimiterComponent(components, { ...options, keyPrefix: 'svc-a' }).withRateLimitMiddleware()
    const second = createRateLimiterComponent(components, { ...options, keyPrefix: 'svc-b' }).withRateLimitMiddleware()
    await callTimes(4, first)
    response = await second(context, next)
  })

  it('should not let one exhaust the other', () => {
    expect(response).toEqual(downstreamResponse)
  })
})

describe('when the disclosure level is set', () => {
  describe('and it is always', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        disclosure: RateLimitDisclosure.ALWAYS
      }).withRateLimitMiddleware()
      response = await middleware(context, next)
    })

    it('should emit them on a successful response', () => {
      expect(new Headers(response.headers).get('RateLimit-Limit')).toBe('3')
      expect(new Headers(response.headers).get('RateLimit-Remaining')).toBe('2')
    })
  })

  describe('and it is on-limit', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        disclosure: RateLimitDisclosure.ON_LIMIT
      }).withRateLimitMiddleware()
      response = await middleware(context, next)
    })

    it('should not emit them on a successful response', () => {
      expect(new Headers(response.headers).get('RateLimit-Limit')).toBeNull()
    })

    describe('and the request is rejected', () => {
      beforeEach(async () => {
        response = (await callTimes(3))[2]
      })

      it('should emit the triplet with the reset as delta seconds', () => {
        const rejected = new Headers(response.headers)
        expect(rejected.get('RateLimit-Limit')).toBe('3')
        expect(rejected.get('RateLimit-Remaining')).toBe('0')
        // Delta-seconds, matching the standardized meaning of the name. An absolute epoch value here
        // would read as a multi-millennium backoff to a compliant client.
        expect(rejected.get('RateLimit-Reset')).toBe(rejected.get('Retry-After'))
        expect(Number(rejected.get('RateLimit-Reset'))).toBeLessThanOrEqual(60)
      })
    })
  })

  describe('and it is never', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        disclosure: RateLimitDisclosure.NONE
      }).withRateLimitMiddleware()
      response = (await callTimes(4))[3]
    })

    it('should emit nothing but the status', () => {
      const rejected = new Headers(response.headers)
      expect(rejected.get('Retry-After')).toBeNull()
      expect(rejected.get('RateLimit-Limit')).toBeNull()
      expect(rejected.get('RateLimit-Remaining')).toBeNull()
      expect(rejected.get('RateLimit-Reset')).toBeNull()
    })

    it('should withhold the body too, since naming the limit is disclosure', () => {
      expect(response.status).toBe(429)
      expect(response.body).toBeUndefined()
    })
  })

  describe('and the downstream handler returned a native Response with immutable headers', () => {
    beforeEach(async () => {
      downstreamResponse = new Response('hello', { status: 200 }) as unknown as IHttpServerComponent.IResponse
      Object.defineProperty(downstreamResponse, 'headers', {
        value: new Proxy(new Headers(), {
          get(target, prop) {
            if (prop === 'set') {
              return () => {
                throw new TypeError('immutable headers')
              }
            }
            return Reflect.get(target, prop, target)
          }
        })
      })
      next = jest.fn().mockResolvedValue(downstreamResponse)
      middleware = createRateLimiterComponent(components, {
        ...options,
        disclosure: RateLimitDisclosure.ALWAYS
      }).withRateLimitMiddleware()
      response = await middleware(context, next)
    })

    it('should return it unchanged instead of throwing', () => {
      expect(response).toBe(downstreamResponse)
    })
  })
})

describe('when consuming a key directly', () => {
  beforeEach(() => {
    limiter = createRateLimiterComponent(components, options)
  })

  describe('and the count is under the limit', () => {
    beforeEach(async () => {
      result = await limiter.consume('address:0xabc')
    })

    it('should allow it and report the remaining count', () => {
      expect(result).toEqual(expect.objectContaining({ allowed: true, limit: 3, remaining: 2 }))
    })
  })

  describe('and the count is over the limit', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) await limiter.consume('address:0xabc')
      result = await limiter.consume('address:0xabc')
    })

    it('should reject it with a retry delay', () => {
      expect(result.allowed).toBe(false)
      expect(result.retryAfterSeconds).toBeGreaterThan(0)
    })
  })

  describe('and an override names a different bucket', () => {
    beforeEach(async () => {
      for (let i = 0; i < 4; i++) await limiter.consume('address:0xabc')
      result = await limiter.consume('address:0xabc', { name: 'other' })
    })

    it('should count it separately', () => {
      expect(result.allowed).toBe(true)
    })
  })

  describe('and the store throws', () => {
    beforeEach(async () => {
      cache.increment.mockRejectedValue(new Error('redis down'))
      result = await limiter.consume('address:0xabc')
    })

    it('should report the store as unavailable and follow the fail-open policy', () => {
      expect(result).toEqual(expect.objectContaining({ allowed: true, storeUnavailable: true }))
    })
  })
})

describe('when the limiter is created with an invalid configuration', () => {
  describe.each([
    ['max', { max: 0 }],
    ['windowSeconds', { windowSeconds: -1 }],
    ['keyPrefix', { keyPrefix: '' }],
    ['trustedProxyCount', { trustedProxyCount: 0 }],
    ['fallbackMaxDivisor', { fallbackMaxDivisor: 1.5 }]
  ])('and %s is out of range', (setting, override) => {
    it('should throw an invalid configuration error naming the setting', () => {
      expect(() => createRateLimiterComponent(components, { ...options, ...override })).toThrow(
        InvalidRateLimitConfigurationError
      )
      expect(() => createRateLimiterComponent(components, { ...options, ...override })).toThrow(setting)
    })
  })

  describe('and the cache does not implement increment', () => {
    it('should throw so a stale dependency does not look like an outage', () => {
      expect(() => createRateLimiterComponent({ ...components, cache: {} as any }, options)).toThrow(
        CacheIncrementUnsupportedError
      )
    })
  })

  describe('and a middleware override carries an invalid limit', () => {
    beforeEach(() => {
      limiter = createRateLimiterComponent(components, options)
    })

    it('should throw when the middleware is built rather than on the first request', () => {
      expect(() => limiter.withRateLimitMiddleware({ max: 0 } as RateLimitPolicyOptions)).toThrow(
        InvalidRateLimitConfigurationError
      )
    })
  })
})

describe('when canonicalizing an IP address', () => {
  describe('and it is a plain IPv4 address', () => {
    it('should return it unchanged', () => {
      expect(canonicalizeIpAddress('203.0.113.7')).toBe('203.0.113.7')
    })
  })

  describe('and it is an IPv4 address carrying a port', () => {
    it('should strip the port', () => {
      expect(canonicalizeIpAddress('203.0.113.7:53124')).toBe('203.0.113.7')
    })
  })

  describe('and it is an uppercase, non-compressed IPv6 address', () => {
    it('should return the lowercase compressed form', () => {
      expect(canonicalizeIpAddress('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
    })
  })

  describe('and it is an IPv4-mapped IPv6 address', () => {
    it('should return the dotted quad so one client maps to one bucket', () => {
      expect(canonicalizeIpAddress('::ffff:203.0.113.7')).toBe('203.0.113.7')
    })
  })

  describe('and it is a bracketed IPv6 address carrying a port', () => {
    it('should return the canonical address without the brackets or the port', () => {
      expect(canonicalizeIpAddress('[2001:db8::1]:443')).toBe('2001:db8::1')
    })
  })

  describe('and it is an IPv4 address with leading zeros', () => {
    it('should reject it rather than treat two spellings as two clients', () => {
      expect(canonicalizeIpAddress('203.0.113.010')).toBeNull()
    })
  })

  describe('and it is not an address at all', () => {
    it('should return null so a caller cannot mint arbitrary buckets', () => {
      expect(canonicalizeIpAddress('not-an-address')).toBeNull()
    })
  })

  describe('and it is empty or undefined', () => {
    it('should return null', () => {
      expect(canonicalizeIpAddress('')).toBeNull()
      expect(canonicalizeIpAddress(undefined)).toBeNull()
    })
  })
})

describe('when extracting the client IP from a forwarded header', () => {
  describe('and the header is absent', () => {
    it('should return null', () => {
      expect(clientIpFromForwardedHeader(null, 1)).toBeNull()
    })
  })

  describe('and it holds a single address with one trusted proxy', () => {
    it('should return that address', () => {
      expect(clientIpFromForwardedHeader('203.0.113.7', 1)).toBe('203.0.113.7')
    })
  })

  describe('and a client-spoofed entry precedes the proxy-appended one', () => {
    it('should return the proxy-appended entry rather than the client-supplied one', () => {
      expect(clientIpFromForwardedHeader('1.1.1.1, 203.0.113.7', 1)).toBe('203.0.113.7')
    })
  })

  describe('and two proxies are trusted', () => {
    it('should return the entry two positions from the right', () => {
      expect(clientIpFromForwardedHeader('1.1.1.1, 203.0.113.7, 10.0.0.1', 2)).toBe('203.0.113.7')
    })
  })

  describe('and it holds fewer entries than the trusted proxy chain would produce', () => {
    it('should return null because the header did not come through that chain', () => {
      expect(clientIpFromForwardedHeader('203.0.113.7', 2)).toBeNull()
    })
  })

  describe('and the selected entry is not an address', () => {
    it('should return null', () => {
      expect(clientIpFromForwardedHeader('1.1.1.1, garbage', 1)).toBeNull()
    })
  })

  describe('and it contains empty entries and padding', () => {
    it('should ignore them and still select the right entry', () => {
      expect(clientIpFromForwardedHeader(' 1.1.1.1 ,, 203.0.113.7 ', 1)).toBe('203.0.113.7')
    })
  })
})

describe('when computing the current window', () => {
  describe('and now sits exactly on a boundary', () => {
    it('should start the window there and reset one window later', () => {
      expect(currentWindow(60_000, 60_000)).toEqual({ windowId: 1, resetAt: 120_000 })
    })
  })

  describe('and now sits mid-window', () => {
    it('should reset at the next boundary', () => {
      expect(currentWindow(90_000, 60_000)).toEqual({ windowId: 1, resetAt: 120_000 })
    })
  })
})

describe('when building a counter key', () => {
  it('should join the segments in namespace order', () => {
    expect(buildCounterKey('svc:rl', 'login', 12345, '203.0.113.7')).toBe('svc:rl:login:12345:203.0.113.7')
  })
})

describe('when encoding an identity', () => {
  describe('and hashing is off and the identity is short', () => {
    it('should return it tagged as raw rather than bare', () => {
      expect(encodeIdentity('203.0.113.7', false)).toBe('r:203.0.113.7')
    })
  })

  describe('and hashing is on', () => {
    it('should return a tagged 32-character lowercase hex digest', () => {
      expect(encodeIdentity('203.0.113.7', true)).toMatch(/^h:[0-9a-f]{32}$/)
    })
  })

  describe('and the identity exceeds the raw cap with hashing off', () => {
    it('should hash it anyway so an oversized value cannot become an oversized key', () => {
      expect(encodeIdentity('a'.repeat(MAX_RAW_IDENTITY_LENGTH + 1), false)).toMatch(/^h:[0-9a-f]{32}$/)
    })
  })

  describe('and a short identity impersonates the digest of a long one', () => {
    let hashed: string
    let impersonation: string

    beforeEach(() => {
      const victim = 'u'.repeat(MAX_RAW_IDENTITY_LENGTH + 72)
      hashed = encodeIdentity(victim, false)
      impersonation = encodeIdentity(hashed.slice(2), false)
    })

    it('should keep the two in separate keyspaces so it cannot land on the long identity bucket', () => {
      expect(impersonation).not.toBe(hashed)
    })
  })

  describe('and the identity is exactly at the raw length cap', () => {
    it('should still store it raw, pinning the boundary as inclusive', () => {
      expect(encodeIdentity('u'.repeat(MAX_RAW_IDENTITY_LENGTH), false)).toBe(`r:${'u'.repeat(MAX_RAW_IDENTITY_LENGTH)}`)
    })
  })

  describe('and two different identities are hashed', () => {
    it('should produce different digests', () => {
      expect(encodeIdentity('one', true)).not.toBe(encodeIdentity('two', true))
    })
  })
})

describe('when deciding whether to skip a request', () => {
  describe('and the skipper is a string', () => {
    it('should skip only the matching pathname', () => {
      expect(shouldSkip(createContext({ pathname: '/health/live' }), '/health/live')).toBe(true)
      expect(shouldSkip(createContext({ pathname: '/v1/notes' }), '/health/live')).toBe(false)
    })
  })

  describe('and the skipper is an array of strings', () => {
    let skipper: RateLimitSkipper

    beforeEach(() => {
      skipper = ['/health/live', '/health/ready']
    })

    it('should skip any matching pathname', () => {
      expect(shouldSkip(createContext({ pathname: '/health/ready' }), skipper)).toBe(true)
      expect(shouldSkip(createContext({ pathname: '/v1/notes' }), skipper)).toBe(false)
    })
  })

  describe('and the skipper is a function', () => {
    let skipper: jest.Mock

    beforeEach(() => {
      skipper = jest.fn().mockReturnValue(true)
    })

    it('should defer to it', () => {
      expect(shouldSkip(createContext({ pathname: '/v1/notes' }), skipper)).toBe(true)
      expect(skipper).toHaveBeenCalled()
    })
  })

  describe('and the skipper is a regular expression', () => {
    it('should test it against the pathname', () => {
      expect(shouldSkip(createContext({ pathname: '/health/live' }), /^\/health\//)).toBe(true)
      expect(shouldSkip(createContext({ pathname: '/v1/notes' }), /^\/health\//)).toBe(false)
    })
  })

  describe('and the regular expression carries the global flag', () => {
    let skipper: RegExp

    beforeEach(() => {
      skipper = /^\/health\//g
    })

    it('should match consistently across repeated calls instead of alternating on lastIndex', () => {
      expect(shouldSkip(createContext({ pathname: '/health/live' }), skipper)).toBe(true)
      expect(shouldSkip(createContext({ pathname: '/health/live' }), skipper)).toBe(true)
    })
  })
})

describe('when asserting a positive integer', () => {
  describe.each([
    ['zero', 0],
    ['a negative number', -1],
    ['a fractional number', 1.5],
    ['NaN', NaN],
    ['a non-number', 'ten']
  ])('and the value is %s', (_label, value) => {
    it('should throw an invalid configuration error naming the setting', () => {
      expect(() => assertPositiveInteger('max', value)).toThrow(InvalidRateLimitConfigurationError)
      expect(() => assertPositiveInteger('max', value)).toThrow('max')
    })
  })

  describe('and the value is a positive integer', () => {
    it('should not throw', () => {
      expect(() => assertPositiveInteger('max', 1)).not.toThrow()
    })
  })
})

describe('when an override carries a key whose value is undefined', () => {
  let responses: IHttpServerComponent.IResponse[]

  beforeEach(async () => {
    // The shape an optional config field produces: `{ max: config.loginMax }` with nothing set.
    // ON_LIMIT so the resolved limit is observable in the response headers.
    options = { ...options, max: 3, failOpen: false, disclosure: RateLimitDisclosure.ON_LIMIT }
    limiter = createRateLimiterComponent(components, options)
    middleware = limiter.withRateLimitMiddleware({ max: undefined, failOpen: undefined })
    responses = await callTimes(4)
  })

  it('should keep the component-wide limit rather than falling back to the built-in default', () => {
    expect(responses[2].status).not.toBe(429)
    expect(responses[3].status).toBe(429)
  })

  it('should report the component-wide limit in the headers', () => {
    expect(new Headers(responses[3].headers).get('RateLimit-Limit')).toBe('3')
  })

  describe('and the store then fails', () => {
    beforeEach(async () => {
      cache.increment.mockRejectedValue(new Error('redis down'))
      response = await middleware(context, next)
    })

    it('should keep a component-wide failOpen of false', () => {
      expect(response.status).toBe(429)
    })
  })

  describe('and consume is called with the same shape of override', () => {
    beforeEach(async () => {
      result = await limiter.consume('address:0xabc', { max: undefined })
    })

    it('should keep the component-wide value there too', () => {
      expect(result.limit).toBe(3)
    })
  })
})

describe('when the custom limit exceeded response builder fails', () => {
  describe('and it throws', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        buildLimitExceededResponse: () => {
          throw new Error('boom')
        }
      }).withRateLimitMiddleware()
      response = (await callTimes(4))[3]
    })

    it('should still reject with the default too many requests response', () => {
      expect(response.status).toBe(429)
      expect(response.body).toEqual({ ok: false, message: 'Too many requests' })
    })

    it('should still set Retry-After so the client does not retry immediately', () => {
      expect(new Headers(response.headers).get('Retry-After')).toEqual(expect.any(String))
    })

    it('should log the failure', () => {
      expect(errorMock).toHaveBeenCalledWith(
        'The buildLimitExceededResponse hook threw; falling back to the default response',
        expect.objectContaining({ error: 'boom' })
      )
    })
  })

  describe('and it returns nothing', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        buildLimitExceededResponse: () => undefined as unknown as IHttpServerComponent.IResponse
      }).withRateLimitMiddleware()
      response = (await callTimes(4))[3]
    })

    it('should fall back to the default response instead of returning nothing', () => {
      expect(response.status).toBe(429)
    })
  })
})

describe('when the downstream handler returns no response at all', () => {
  beforeEach(async () => {
    next = jest.fn().mockResolvedValue(undefined)
    middleware = createRateLimiterComponent(components, {
      ...options,
      disclosure: RateLimitDisclosure.ALWAYS
    }).withRateLimitMiddleware()
    response = await middleware(context, next)
  })

  it('should pass it through untouched so the server can produce its own error', () => {
    expect(response).toBeUndefined()
  })
})

describe('when a trusted client IP header is configured but yields no address', () => {
  beforeEach(() => {
    options = { ...options, trustedClientIpHeader: 'cf-connecting-ip' }
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
  })

  describe('and the header is absent while a socket address exists', () => {
    beforeEach(async () => {
      await middleware(createContext(), next)
    })

    it('should warn that requests are being keyed on the connecting address', () => {
      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining('was not present on the request'),
        expect.objectContaining({ issue: RateLimitAddressIssue.TRUSTED_HEADER_MISSING })
      )
    })

    it('should count the issue so it is alertable rather than only greppable', () => {
      expect(metrics.increment).toHaveBeenCalledWith('rate_limiter_client_address_issues_total', {
        bucket: '3p60',
        issue: RateLimitAddressIssue.TRUSTED_HEADER_MISSING
      })
    })

    it('should still fall through to the socket address', () => {
      expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('203.0.113.7'), expect.anything())
    })
  })

  describe('and the header is present but unparseable', () => {
    beforeEach(async () => {
      await middleware(createContext({ headers: { 'cf-connecting-ip': 'garbage' } }), next)
    })

    it('should distinguish a bad value from a missing header, which have different causes', () => {
      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining('held no usable address'),
        expect.objectContaining({ issue: RateLimitAddressIssue.TRUSTED_HEADER_UNUSABLE })
      )
    })

    it('should count it under its own issue label', () => {
      expect(metrics.increment).toHaveBeenCalledWith('rate_limiter_client_address_issues_total', {
        bucket: '3p60',
        issue: RateLimitAddressIssue.TRUSTED_HEADER_UNUSABLE
      })
    })
  })

  describe('and many requests arrive inside the log interval', () => {
    beforeEach(async () => {
      await callTimes(3, middleware, createContext())
    })

    it('should log once, so the message does not scale with traffic', () => {
      expect(warnMock.mock.calls.filter(call => String(call[0]).includes('was not present')).length).toBe(1)
    })

    it('should still count every affected request, so the metric shows the real volume', () => {
      const counted = metrics.increment.mock.calls.filter(
        call => call[0] === 'rate_limiter_client_address_issues_total'
      )
      expect(counted).toHaveLength(3)
    })
  })

  describe('and the condition persists past the log interval', () => {
    beforeEach(async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-13T10:00:00.000Z'))
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      await middleware(createContext(), next)
      jest.setSystemTime(new Date('2026-08-13T10:11:00.000Z'))
      await middleware(createContext(), next)
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should say so again, rather than going quiet for the life of the process', () => {
      expect(warnMock.mock.calls.filter(call => String(call[0]).includes('was not present')).length).toBe(2)
    })
  })
})

describe('when the store is unavailable and the headers mode is always', () => {
  beforeEach(async () => {
    cache.increment.mockRejectedValue(new Error('redis down'))
    middleware = createRateLimiterComponent(components, {
      ...options,
      disclosure: RateLimitDisclosure.ALWAYS
    }).withRateLimitMiddleware()
    response = await middleware(context, next)
  })

  it('should serve the request', () => {
    expect(response).toEqual(downstreamResponse)
  })

  it('should not advertise a zero remaining count, which would tell clients to stop sending', () => {
    expect(new Headers(response.headers).get('RateLimit-Remaining')).toBeNull()
  })
})

describe('when the store error is logged', () => {
  beforeEach(async () => {
    cache.increment.mockRejectedValue(new Error('redis down'))
    middleware = createRateLimiterComponent(components, { ...options, failOpen: false }).withRateLimitMiddleware()
    await middleware(context, next)
  })

  it('should record the failOpen policy so a shared log line cannot describe the wrong endpoint', () => {
    expect(errorMock).toHaveBeenCalledWith(
      expect.stringContaining('rejecting requests'),
      expect.objectContaining({ bucket: '3p60', failOpen: 'false' })
    )
  })
})

describe('when consuming with an identity that is not usable', () => {
  beforeEach(() => {
    limiter = createRateLimiterComponent(components, { ...options, max: 30 })
  })

  describe('and it is an empty string', () => {
    beforeEach(async () => {
      result = await limiter.consume('')
    })

    it('should route it to the shared bucket at the tightened cap rather than the full limit', () => {
      expect(result.keySource).toBe(RateLimitKeySource.FALLBACK)
      expect(result.limit).toBe(3)
      expect(result.identity).toBe(FALLBACK_IDENTITY)
    })

    it('should warn so the caller learns it is not getting per-caller limiting', () => {
      expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('empty identity'), expect.anything())
    })
  })

  describe('and it is blank', () => {
    beforeEach(async () => {
      result = await limiter.consume('   ')
    })

    it('should treat it as empty', () => {
      expect(result.keySource).toBe(RateLimitKeySource.FALLBACK)
    })
  })

  describe('and it is not a string', () => {
    it('should throw rather than build a key from it', async () => {
      await expect(limiter.consume(null as unknown as string)).rejects.toThrow(InvalidRateLimitConfigurationError)
    })
  })
})

describe('when the identity carries an IPv6 zone identifier', () => {
  let zonedKeys: string[]

  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await middleware(createContext({ remoteAddress: 'fe80::1%eth0' }), next)
    await middleware(createContext({ remoteAddress: 'fe80::1%eth1' }), next)
    zonedKeys = cache.increment.mock.calls.map(call => call[0] as string)
  })

  it('should keep peers on different interfaces in separate buckets instead of the shared one', () => {
    expect(new Set(zonedKeys).size).toBe(2)
    expect(zonedKeys.every(key => !key.includes(FALLBACK_IDENTITY))).toBe(true)
  })
})

describe('when canonicalizing a zoned address directly', () => {
  it('should preserve the zone alongside the canonical address', () => {
    expect(canonicalizeIpAddress('fe80::1%eth0')).toBe('fe80::1%eth0')
  })

  it('should still reject a zone attached to something that is not an address', () => {
    expect(canonicalizeIpAddress('garbage%eth0')).toBeNull()
  })
})

describe('when the component is configured with an unusable option value', () => {
  describe.each([
    ['disclosure', { disclosure: 'None' as unknown as RateLimitDisclosure }],
    ['trustedClientIpHeader', { trustedClientIpHeader: '' }],
    ['name', { name: 'has:colon' }],
    ['windowSeconds', { windowSeconds: 3_600_000 }]
  ])('and %s is invalid', (setting, override) => {
    it('should throw at construction naming the setting', () => {
      expect(() => createRateLimiterComponent(components, { ...options, ...override })).toThrow(
        InvalidRateLimitConfigurationError
      )
      expect(() => createRateLimiterComponent(components, { ...options, ...override })).toThrow(setting)
    })
  })
})

describe('when both a getKey function and a trusted header are configured', () => {
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, {
      ...options,
      trustedClientIpHeader: 'x-forwarded-for',
      getKey: () => 'address:0xabc'
    }).withRateLimitMiddleware()
    await middleware(createContext({ headers: { 'x-forwarded-for': '198.51.100.4' } }), next)
  })

  it('should prefer the getKey result, pinning the documented precedence', () => {
    expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('address:0xabc'), expect.anything())
  })
})

describe('when getKey returns an empty string', () => {
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, { ...options, getKey: () => '' }).withRateLimitMiddleware()
    await middleware(context, next)
  })

  it('should fall through to the client address rather than key on nothing', () => {
    expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('203.0.113.7'), expect.anything())
  })
})

describe('when getKey is invoked', () => {
  let getKey: jest.Mock

  beforeEach(async () => {
    getKey = jest.fn().mockReturnValue('address:0xabc')
    middleware = createRateLimiterComponent(components, { ...options, getKey }).withRateLimitMiddleware()
    await middleware(context, next)
  })

  it('should receive the request context, which is what makes reading auth off it possible', () => {
    expect(getKey).toHaveBeenCalledWith(context)
  })
})

describe('when hashKeys is enabled on the component', () => {
  let keys: string[]

  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, { ...options, hashKeys: true }).withRateLimitMiddleware()
    await middleware(context, next)
    keys = cache.increment.mock.calls.map(call => call[0] as string)
  })

  it('should store a digest rather than the raw address', () => {
    expect(keys[0]).toMatch(/:h:[0-9a-f]{32}$/)
    expect(keys[0]).not.toContain('203.0.113.7')
  })
})

describe('when more than one proxy is trusted', () => {
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, {
      ...options,
      trustedClientIpHeader: 'x-forwarded-for',
      trustedProxyCount: 2
    }).withRateLimitMiddleware()
    await middleware(createContext({ headers: { 'x-forwarded-for': '1.1.1.1, 198.51.100.4, 10.0.0.1' } }), next)
  })

  it('should key on the entry the configured hop count selects, not the rightmost one', () => {
    expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('198.51.100.4'), expect.anything())
  })
})

describe('when the socket address is not a usable IP address', () => {
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await middleware(createContext({ remoteAddress: 'not-an-address' }), next)
  })

  it('should route the request to the shared bucket rather than key on the garbage', () => {
    expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining(FALLBACK_IDENTITY), expect.anything())
  })
})

describe('when an onStoreError hook receives a failure', () => {
  let onStoreError: jest.Mock
  let storeError: Error

  beforeEach(async () => {
    storeError = new Error('redis down')
    onStoreError = jest.fn()
    cache.increment.mockRejectedValue(storeError)
    middleware = createRateLimiterComponent(components, { ...options, onStoreError }).withRateLimitMiddleware()
    await middleware(context, next)
  })

  it('should pass the context and the underlying error, not just fire', () => {
    expect(onStoreError).toHaveBeenCalledWith(context, storeError)
  })
})

describe('when the store keeps failing past the log interval', () => {
  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T10:00:00.000Z'))
    cache.increment.mockRejectedValue(new Error('redis down'))
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await middleware(context, next)
    jest.setSystemTime(new Date('2026-08-13T10:00:11.000Z'))
    await middleware(context, next)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should log again rather than going silent for the rest of the outage', () => {
    expect(errorMock).toHaveBeenCalledTimes(2)
  })
})

describe('when the downstream handler returns a Response from another implementation', () => {
  beforeEach(async () => {
    // A node-fetch style response: `status`/`body` live on the prototype, so spreading it would
    // serve a bodiless 200. It fails `instanceof Response`, which is why the duck-type check exists.
    const foreign = Object.create({
      get status() {
        return 207
      },
      get body() {
        return 'hello'
      },
      clone() {
        return this
      }
    })
    foreign.headers = new Headers()
    downstreamResponse = foreign as IHttpServerComponent.IResponse
    next = jest.fn().mockResolvedValue(downstreamResponse)
    middleware = createRateLimiterComponent(components, {
      ...options,
      disclosure: RateLimitDisclosure.ALWAYS
    }).withRateLimitMiddleware()
    response = await middleware(context, next)
  })

  it('should keep its status and body instead of spreading them away', () => {
    expect(response.status).toBe(207)
    expect(response.body).toBe('hello')
  })

  it('should still attach the rate limit headers', () => {
    expect(new Headers(response.headers).get('RateLimit-Limit')).toBe('3')
  })
})

describe('when a custom limit exceeded response sets its own rate limit headers', () => {
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, {
      ...options,
      disclosure: RateLimitDisclosure.ON_LIMIT,
      buildLimitExceededResponse: () => ({ status: 429, headers: { 'RateLimit-Limit': '999' } })
    }).withRateLimitMiddleware()
    response = (await callTimes(4))[3]
  })

  it('should overwrite them with the real limit, so the advertised value cannot be wrong', () => {
    expect(new Headers(response.headers).get('RateLimit-Limit')).toBe('3')
  })
})

describe('when the limiter is mounted inside a router', () => {
  let routedContext: IHttpServerComponent.DefaultContext<object>

  beforeEach(async () => {
    // The router puts the matched template on the context; that, not the request path, is the label.
    routedContext = { ...createContext({ pathname: '/v1/notes/abc-123' }), routerPath: '/v1/notes/:id' } as any
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await middleware(routedContext, next)
  })

  it('should label the metric with the route template, not the request path', () => {
    expect(metrics.increment).toHaveBeenCalledWith(
      'rate_limiter_requests_total',
      expect.objectContaining({ handler: '/v1/notes/:id' })
    )
  })

  it('should keep the path out of the labels, since ids there would be unbounded cardinality', () => {
    const labels = metrics.increment.mock.calls.map(call => JSON.stringify(call[1]))
    expect(labels.every(label => !label.includes('abc-123'))).toBe(true)
  })
})

describe('when the counter store fails', () => {
  beforeEach(async () => {
    cache.increment.mockRejectedValue(new Error('redis down'))
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await middleware(context, next)
  })

  it('should count a store error against the bucket, recording the fail-open policy', () => {
    expect(metrics.increment).toHaveBeenCalledWith('rate_limiter_store_errors_total', {
      bucket: '3p60',
      fail_open: 'true'
    })
  })

  it('should mark the request degraded rather than allowed, so an outage cannot look healthy', () => {
    expect(metrics.increment).toHaveBeenCalledWith(
      'rate_limiter_requests_total',
      expect.objectContaining({ outcome: RateLimitOutcome.DEGRADED })
    )
  })
})

describe('when consuming a key directly outside the HTTP path', () => {
  beforeEach(async () => {
    limiter = createRateLimiterComponent(components, options)
    await limiter.consume('address:0xabc')
  })

  it('should still record the outcome, with no route to attribute it to', () => {
    expect(metrics.increment).toHaveBeenCalledWith('rate_limiter_requests_total', {
      bucket: '3p60',
      handler: '',
      outcome: RateLimitOutcome.ALLOWED,
      key_source: RateLimitKeySource.CUSTOM
    })
  })
})

describe('when a request is skipped', () => {
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, {
      ...options,
      skip: '/health/live'
    }).withRateLimitMiddleware()
    await middleware(createContext({ pathname: '/health/live' }), next)
  })

  it('should not record a metric for it, since it was never counted', () => {
    expect(metrics.increment).not.toHaveBeenCalled()
  })
})

describe('when comparing what each disclosure level reveals on a rejection', () => {
  let revealed: Record<string, { status?: number; body: unknown; headers: Record<string, string | null> }>

  beforeEach(async () => {
    revealed = {}
    for (const disclosure of [
      RateLimitDisclosure.NONE,
      RateLimitDisclosure.RETRY_AFTER,
      RateLimitDisclosure.ON_LIMIT,
      RateLimitDisclosure.ALWAYS
    ]) {
      cache = createFakeCache()
      metrics = createFakeMetrics()
      const rejected = await callTimes(
        4,
        createRateLimiterComponent(
          { cache, logs, metrics: metrics as unknown as RateLimiterComponents['metrics'] },
          { ...options, disclosure }
        ).withRateLimitMiddleware()
      )
      const headers = new Headers(rejected[3].headers)
      revealed[disclosure] = {
        status: rejected[3].status,
        body: rejected[3].body,
        headers: {
          retryAfter: headers.get('Retry-After'),
          limit: headers.get('RateLimit-Limit'),
          remaining: headers.get('RateLimit-Remaining'),
          reset: headers.get('RateLimit-Reset')
        }
      }
    }
  })

  it('should reject with the same status at every level', () => {
    expect(Object.values(revealed).every(entry => entry.status === 429)).toBe(true)
  })

  it('should reveal nothing but the status at the lowest level', () => {
    expect(revealed[RateLimitDisclosure.NONE]).toEqual({
      status: 429,
      body: undefined,
      headers: { retryAfter: null, limit: null, remaining: null, reset: null }
    })
  })

  it('should add only the delay and a generic body at the retry-after level', () => {
    const entry = revealed[RateLimitDisclosure.RETRY_AFTER]
    expect(entry.body).toEqual({ ok: false, message: 'Too many requests' })
    expect(Number(entry.headers.retryAfter)).toBeGreaterThan(0)
    expect(entry.headers.limit).toBeNull()
  })

  it('should add the limit triplet on top of that at the on-limit level', () => {
    const entry = revealed[RateLimitDisclosure.ON_LIMIT]
    expect(Number(entry.headers.retryAfter)).toBeGreaterThan(0)
    expect(entry.headers.limit).toBe('3')
    expect(entry.headers.remaining).toBe('0')
    expect(entry.headers.reset).toBe(entry.headers.retryAfter)
  })

  it('should reveal the same as on-limit when rejecting at the always level', () => {
    expect(revealed[RateLimitDisclosure.ALWAYS]).toEqual(revealed[RateLimitDisclosure.ON_LIMIT])
  })

  it('should form a strict escalation, each level a superset of the one below', () => {
    const disclosed = (entry: (typeof revealed)[string]) =>
      Object.entries(entry.headers)
        .filter(([, value]) => value !== null)
        .map(([name]) => name)
        .concat(entry.body === undefined ? [] : ['body'])

    const none = disclosed(revealed[RateLimitDisclosure.NONE])
    const retryAfter = disclosed(revealed[RateLimitDisclosure.RETRY_AFTER])
    const onLimit = disclosed(revealed[RateLimitDisclosure.ON_LIMIT])

    expect(none).toHaveLength(0)
    expect(retryAfter).toEqual(expect.arrayContaining(none))
    expect(onLimit).toEqual(expect.arrayContaining(retryAfter))
    expect(onLimit.length).toBeGreaterThan(retryAfter.length)
  })
})

describe('when the disclosure level is none and a custom response is configured', () => {
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, {
      ...options,
      disclosure: RateLimitDisclosure.NONE,
      buildLimitExceededResponse: () => ({ status: 429, body: { error: 'slow down' } })
    }).withRateLimitMiddleware()
    response = (await callTimes(4))[3]
  })

  it('should serve the caller body as-is, since the level suppresses what the component adds', () => {
    expect(response.body).toEqual({ error: 'slow down' })
  })

  it('should still add no headers of its own', () => {
    expect(new Headers(response.headers).get('Retry-After')).toBeNull()
  })
})

describe('when the disclosure level is none and the store is unavailable', () => {
  beforeEach(async () => {
    cache.increment.mockRejectedValue(new Error('redis down'))
    middleware = createRateLimiterComponent(components, {
      ...options,
      disclosure: RateLimitDisclosure.NONE,
      failOpen: false
    }).withRateLimitMiddleware()
    response = await middleware(context, next)
  })

  it('should reject without revealing that a rate limit was involved', () => {
    expect(response.status).toBe(429)
    expect(response.body).toBeUndefined()
    expect(new Headers(response.headers).get('Retry-After')).toBeNull()
  })
})

describe('when no trusted client IP header is configured', () => {
  beforeEach(() => {
    options = { ...options, trustedClientIpHeader: undefined }
  })

  describe('and the request carries no forwarding header', () => {
    beforeEach(async () => {
      // A directly exposed service: the socket address really is the client, so this is correct and
      // must stay silent.
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      await middleware(createContext(), next)
    })

    it('should key on the socket address', () => {
      expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('203.0.113.7'), expect.anything())
    })

    it('should not warn, since a directly exposed service is a legitimate deployment', () => {
      expect(warnMock).not.toHaveBeenCalled()
    })
  })

  describe.each([['cf-connecting-ip'], ['x-forwarded-for'], ['x-real-ip'], ['true-client-ip'], ['forwarded']])(
    'and the request carries a %s header that nothing reads',
    header => {
      beforeEach(async () => {
        middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
        await middleware(createContext({ headers: { [header]: '198.51.100.4' } }), next)
      })

      it('should stay silent, since any client can send that header at will', () => {
        expect(warnMock).not.toHaveBeenCalled()
      })

      it('should count no issue, so an outsider cannot inflate an alert-worthy counter', () => {
        expect(metrics.increment).not.toHaveBeenCalledWith(
          'rate_limiter_client_address_issues_total',
          expect.anything()
        )
      })

      it('should key on the socket address rather than the unverified header', () => {
        expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('203.0.113.7'), expect.anything())
      })
    }
  )

  describe('and many such requests arrive', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      await callTimes(3, middleware, createContext({ headers: { 'x-forwarded-for': '198.51.100.4' } }))
    })

    it('should stay silent however many arrive, since the trigger would be caller-controlled', () => {
      expect(warnMock).not.toHaveBeenCalled()
    })
  })

  describe('and a getKey already resolved the identity', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        getKey: () => 'address:0xabc'
      }).withRateLimitMiddleware()
      await middleware(createContext({ headers: { 'x-forwarded-for': '198.51.100.4' } }), next)
    })

    it('should not warn, since nothing is being keyed on the connecting address', () => {
      expect(warnMock).not.toHaveBeenCalled()
    })
  })

  describe('and there is no socket address either', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
      await middleware(createContext({ remoteAddress: undefined }), next)
    })

    it('should report the shared bucket rather than the ignored-header case', () => {
      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining('every caller shares one rate limit bucket'),
        expect.objectContaining({ issue: RateLimitAddressIssue.NO_CLIENT_ADDRESS })
      )
    })
  })
})

describe('when the middleware runs inside a router layer', () => {
  let buckets: string[]

  function routed(method: string, routerPath: string, pathname: string) {
    return { ...createContext({ pathname }), routerPath, request: new Request(`http://rate-limiter.test${pathname}`, { method }) } as any
  }

  beforeEach(async () => {
    limiter = createRateLimiterComponent(components, options)
    middleware = limiter.withRateLimitMiddleware()
    await middleware(routed('POST', '/v1/login', '/v1/login'), next)
    await middleware(routed('POST', '/v1/signup', '/v1/signup'), next)
    await middleware(routed('GET', '/v1/notes/:id', '/v1/notes/abc-123'), next)
    buckets = cache.increment.mock.calls.map(call => (call[0] as string).split(':')[2])
  })

  it('should give each endpoint its own budget rather than merging identical limits', () => {
    expect(new Set(buckets).size).toBe(3)
  })

  it('should bucket by method and route so the endpoint is legible in the key', () => {
    expect(buckets[0]).toBe('POST /v1/login')
    expect(buckets[1]).toBe('POST /v1/signup')
  })

  it('should template path parameters, so the bucket count is bounded by routes not by ids', () => {
    expect(buckets[2]).toBe('GET /v1/notes/{id}')
  })

  it('should separate methods on the same path, which usually cost different amounts', async () => {
    cache.increment.mockClear()
    await middleware(routed('GET', '/v1/notes', '/v1/notes'), next)
    await middleware(routed('POST', '/v1/notes', '/v1/notes'), next)
    const both = cache.increment.mock.calls.map(call => (call[0] as string).split(':')[2])
    expect(new Set(both).size).toBe(2)
  })

  describe('and one endpoint exhausts its allowance', () => {
    let otherEndpoint: IHttpServerComponent.IResponse

    beforeEach(async () => {
      await callTimes(4, middleware, routed('POST', '/v1/login', '/v1/login'))
      otherEndpoint = await middleware(routed('POST', '/v1/signup', '/v1/signup'), next)
    })

    it('should leave the other endpoint unaffected', () => {
      expect(otherEndpoint.status).not.toBe(429)
    })
  })

  describe('and an explicit name is given', () => {
    beforeEach(async () => {
      cache.increment.mockClear()
      middleware = limiter.withRateLimitMiddleware({ name: 'shared-write-budget' })
      await middleware(routed('POST', '/v1/login', '/v1/login'), next)
      await middleware(routed('POST', '/v1/signup', '/v1/signup'), next)
      buckets = cache.increment.mock.calls.map(call => (call[0] as string).split(':')[2])
    })

    it('should honour it over the route, so endpoints can deliberately share a budget', () => {
      expect(buckets).toEqual(['shared-write-budget', 'shared-write-budget'])
    })
  })
})

describe('when the middleware is mounted globally rather than per route', () => {
  let buckets: string[]

  beforeEach(async () => {
    // No routerPath: this is what a `server.use()` mount sees, since it runs before routing.
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await middleware(createContext({ pathname: '/v1/login' }), next)
    await middleware(createContext({ pathname: '/v1/signup' }), next)
    buckets = cache.increment.mock.calls.map(call => (call[0] as string).split(':')[2])
  })

  it('should keep one shared budget across every route, which is what global means', () => {
    expect(buckets).toEqual(['3p60', '3p60'])
  })

  it('should count both requests against it', async () => {
    const responses = await callTimes(2, middleware, createContext({ pathname: '/v1/other' }))
    expect(responses[1].status).toBe(429)
  })
})

describe('when consuming outside the HTTP path', () => {
  beforeEach(async () => {
    limiter = createRateLimiterComponent(components, options)
    await limiter.consume('address:0xabc')
  })

  it('should use the fallback bucket, since there is no route to attribute it to', () => {
    expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining(':3p60:'), expect.anything())
  })
})

describe('when the suite counts several requests inside one test', () => {
  let windowIds: string[]

  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await callTimes(4)
    windowIds = cache.increment.mock.calls.map(call => (call[0] as string).split(':')[3])
  })

  it('should place them all in one window, which is what makes the limit assertions deterministic', () => {
    expect(new Set(windowIds).size).toBe(1)
  })

  it('should be running on a frozen clock, so a boundary cannot fall between two requests', () => {
    // Compares against the pinned instant rather than asking jest whether timers are faked, which
    // does not throw when they are not. Without the freeze this reads the real clock and fails, so
    // removing it cannot pass unnoticed — the straddle it prevents is otherwise rare enough to look
    // like an unrelated flake.
    expect(Date.now()).toBe(FROZEN_NOW.getTime())
  })
})

describe('when the matched route is not a literal path', () => {
  let buckets: string[]

  function withRouterPath(routerPath: string, method = 'GET') {
    return {
      ...createContext(),
      routerPath,
      request: new Request('http://rate-limiter.test/anything', { method })
    } as any
  }

  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    // What `router.use(middleware)` with no path mounts at: a pattern matching everything, not a route.
    await middleware(withRouterPath('([^/]*)', 'GET'), next)
    await middleware(withRouterPath('([^/]*)', 'POST'), next)
    buckets = cache.increment.mock.calls.map(call => (call[0] as string).split(':')[2])
  })

  it('should fall back to one shared allowance rather than minting a bucket per method', () => {
    expect(buckets).toEqual(['3p60', '3p60'])
  })

  it('should keep router pattern syntax out of the bucket, and so out of keys and metric labels', () => {
    expect(buckets.every(bucket => !bucket.includes('['))).toBe(true)
  })
})

describe('when the same endpoint is hit repeatedly', () => {
  let buckets: string[]

  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    const routed = {
      ...createContext({ pathname: '/v1/notes/abc' }),
      routerPath: '/v1/notes/:id',
      request: new Request('http://rate-limiter.test/v1/notes/abc', { method: 'GET' })
    } as any
    await middleware(routed, next)
    await middleware(routed, next)
    buckets = cache.increment.mock.calls.map(call => (call[0] as string).split(':')[2])
  })

  it('should derive the same bucket each time, memoized or not', () => {
    expect(buckets).toEqual(['GET /v1/notes/{id}', 'GET /v1/notes/{id}'])
  })
})

describe('when the metrics component rejects a metric', () => {
  beforeEach(() => {
    // What a consumer that forgot to register metricDeclarations actually gets: the metrics component
    // throws `Unknown metric …`. Unguarded, that turned every allowed request into a 500.
    metrics.increment.mockImplementation(() => {
      throw new Error('Unknown metric rate_limiter_requests_total')
    })
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
  })

  it('should still serve an allowed request', async () => {
    expect(await middleware(context, next)).toEqual(downstreamResponse)
  })

  it('should still reject once over the limit, so counting is unaffected', async () => {
    expect((await callTimes(4))[3].status).toBe(429)
  })

  it('should warn that activity is not being reported, naming the remedy', async () => {
    await middleware(context, next)
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining('Register the exported metricDeclarations'),
      expect.anything()
    )
  })

  describe('and the counter store is also failing', () => {
    beforeEach(() => {
      cache.increment.mockRejectedValue(new Error('redis down'))
    })

    it('should still fail open rather than let a metrics failure decide the request', async () => {
      expect(await middleware(context, next)).toEqual(downstreamResponse)
    })

    it('should still fail closed when configured to, for the same reason', async () => {
      const closed = createRateLimiterComponent(components, {
        ...options,
        failOpen: false
      }).withRateLimitMiddleware()
      expect((await closed(context, next)).status).toBe(429)
    })
  })
})

describe('when getKey returns a whitespace-only value', () => {
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, {
      ...options,
      getKey: () => '   '
    }).withRateLimitMiddleware()
    await middleware(context, next)
  })

  it('should treat it as no identity and fall through, matching how consume handles blanks', () => {
    expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('203.0.113.7'), expect.anything())
  })
})

describe('when the trusted client IP header is configured with surrounding whitespace', () => {
  beforeEach(async () => {
    // What `CLIENT_IP_HEADER=" cf-connecting-ip "` in an env file produces. `Headers.get` rejects a
    // padded name with `Invalid header name`, so an untrimmed value would raise on every request.
    middleware = createRateLimiterComponent(components, {
      ...options,
      trustedClientIpHeader: '  cf-connecting-ip  '
    }).withRateLimitMiddleware()
    response = await middleware(createContext({ headers: { 'cf-connecting-ip': '198.51.100.4' } }), next)
  })

  it('should serve the request rather than throw on the header lookup', () => {
    expect(response).toEqual(downstreamResponse)
  })

  it('should still read the header, rather than falling back to the socket address', () => {
    expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining('198.51.100.4'), expect.anything())
  })
})
