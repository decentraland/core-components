import { ILoggerComponent } from '@well-known-components/interfaces'
import { IHttpServerComponent, IncrementOptions, IncrementResult } from '@dcl/core-commons'
import { createRateLimiterComponent, FALLBACK_IDENTITY } from '../src/component'
import { CacheIncrementUnsupportedError, InvalidRateLimitConfigurationError } from '../src/errors'
import {
  IRateLimiterComponent,
  RateLimiterComponents,
  RateLimiterOptions,
  RateLimitHeaderMode,
  RateLimitKeySource,
  RateLimitPolicyOptions,
  RateLimitResult,
  RateLimitSkipper
} from '../src/types'

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

let cache: ReturnType<typeof createFakeCache>
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

beforeEach(() => {
  cache = createFakeCache()
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
  components = { cache, logs }
  options = { keyPrefix: 'svc:rl', max: 3, windowSeconds: 60 }
  context = createContext()
  downstreamResponse = { status: 200, body: { ok: true } }
  next = jest.fn().mockResolvedValue(downstreamResponse)
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
    expect(cache.increment).toHaveBeenCalledWith(expect.stringMatching(/^svc:rl:3p60:\d+:203\.0\.113\.7$/), {
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
  beforeEach(async () => {
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    response = (await callTimes(4))[3]
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

  it('should respond with a body naming the retry delay', () => {
    expect(response.body).toEqual({ ok: false, message: expect.stringContaining('Too many requests') })
  })

  it('should emit the rate limit headers by default', () => {
    const headers = new Headers(response.headers)
    expect(headers.get('RateLimit-Limit')).toBe('3')
    expect(headers.get('RateLimit-Remaining')).toBe('0')
    expect(headers.get('RateLimit-Reset')).toEqual(expect.any(String))
  })

  describe('and it is the first rejection in the window', () => {
    it('should warn once naming the bucket, key source and limit', () => {
      expect(warnMock).toHaveBeenCalledTimes(1)
      expect(warnMock).toHaveBeenCalledWith(
        'Request rejected by the rate limiter',
        expect.objectContaining({ bucket: '3p60', keySource: RateLimitKeySource.SOCKET, limit: 3 })
      )
    })
  })

  describe('and a later request in the same window is also rejected', () => {
    beforeEach(async () => {
      await middleware(context, next)
    })

    it('should not warn again', () => {
      expect(warnMock).toHaveBeenCalledTimes(1)
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
  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T10:00:00.000Z'))
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await callTimes(4)
    jest.setSystemTime(new Date('2026-08-13T10:01:00.000Z'))
    response = await middleware(context, next)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should allow a caller that was rejected in the previous window', () => {
    expect(response).toEqual(downstreamResponse)
  })

  it('should count the first request of the new window under a different key', () => {
    const keys = cache.increment.mock.calls.map(call => call[0])
    expect(new Set(keys).size).toBe(2)
  })

  it('should restart the count at one', () => {
    const lastKey = cache.increment.mock.calls[cache.increment.mock.calls.length - 1][0] as string
    expect(cache.counters.get(lastKey)?.value).toBe(1)
  })
})

describe('when the counter is created', () => {
  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T10:00:30.000Z'))
    middleware = createRateLimiterComponent(components, options).withRateLimitMiddleware()
    await middleware(context, next)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should request a TTL covering the rest of the window plus a grace second', () => {
    expect(cache.increment).toHaveBeenCalledWith(expect.any(String), { ttlInSeconds: 31 })
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
  beforeEach(() => {
    context = createContext({ remoteAddress: undefined })
    middleware = createRateLimiterComponent(components, { ...options, max: 100 }).withRateLimitMiddleware()
  })

  it('should count against the shared fallback bucket', async () => {
    await middleware(context, next)
    expect(cache.increment).toHaveBeenCalledWith(expect.stringContaining(FALLBACK_IDENTITY), expect.anything())
  })

  it('should apply the tightened cap rather than the full limit', async () => {
    const responses = await callTimes(11)
    expect(responses[9].status).not.toBe(429)
    expect(responses[10].status).toBe(429)
  })

  it('should warn once about the shared bucket', async () => {
    await callTimes(2)
    expect(warnMock).toHaveBeenCalledTimes(1)
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('every caller shares one rate limit bucket'))
  })

  describe('and the fallback divisor is disabled', () => {
    beforeEach(() => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        max: 100,
        fallbackMaxDivisor: 1
      }).withRateLimitMiddleware()
    })

    it('should apply the full limit', async () => {
      const responses = await callTimes(11)
      expect(responses[10].status).not.toBe(429)
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
      const keys = cache.increment.mock.calls.map(call => call[0])
      expect(new Set(keys).size).toBe(1)
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

  beforeEach(() => {
    limiter = createRateLimiterComponent(components, options)
    loginMiddleware = limiter.withRateLimitMiddleware({ name: 'login', max: 1 })
    notesMiddleware = limiter.withRateLimitMiddleware({ name: 'notes', max: 5 })
  })

  it('should count each against its own bucket', async () => {
    await loginMiddleware(context, next)
    await notesMiddleware(context, next)
    const keys = cache.increment.mock.calls.map(call => call[0] as string)
    expect(keys[0]).toContain(':login:')
    expect(keys[1]).toContain(':notes:')
  })

  it('should still allow the other endpoint once one limit is exhausted', async () => {
    await callTimes(2, loginMiddleware)
    expect((await notesMiddleware(context, next)).status).not.toBe(429)
  })

  describe('and neither middleware is named while both resolve to the same limit', () => {
    beforeEach(() => {
      loginMiddleware = limiter.withRateLimitMiddleware({ max: 4, windowSeconds: 60 })
      notesMiddleware = limiter.withRateLimitMiddleware({ max: 4, windowSeconds: 60 })
    })

    it('should count both against one counter, which is the documented double-count footgun', async () => {
      await loginMiddleware(context, next)
      await notesMiddleware(context, next)
      const keys = cache.increment.mock.calls.map(call => call[0])
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

describe('when the rate limit headers mode is set', () => {
  describe('and it is always', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        emitRateLimitHeaders: RateLimitHeaderMode.ALWAYS
      }).withRateLimitMiddleware()
      response = await middleware(context, next)
    })

    it('should emit them on a successful response', () => {
      const headers = new Headers(response.headers)
      expect(headers.get('RateLimit-Limit')).toBe('3')
      expect(headers.get('RateLimit-Remaining')).toBe('2')
    })
  })

  describe('and it is on-limit', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        emitRateLimitHeaders: RateLimitHeaderMode.ON_LIMIT
      }).withRateLimitMiddleware()
      response = await middleware(context, next)
    })

    it('should not emit them on a successful response', () => {
      expect(new Headers(response.headers).get('RateLimit-Limit')).toBeNull()
    })
  })

  describe('and it is never', () => {
    beforeEach(async () => {
      middleware = createRateLimiterComponent(components, {
        ...options,
        emitRateLimitHeaders: RateLimitHeaderMode.NEVER
      }).withRateLimitMiddleware()
      response = (await callTimes(4))[3]
    })

    it('should emit only Retry-After on the rejection', () => {
      const headers = new Headers(response.headers)
      expect(headers.get('Retry-After')).toEqual(expect.any(String))
      expect(headers.get('RateLimit-Limit')).toBeNull()
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
        emitRateLimitHeaders: RateLimitHeaderMode.ALWAYS
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
      expect(() => createRateLimiterComponent({ cache: {} as any, logs }, options)).toThrow(
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
