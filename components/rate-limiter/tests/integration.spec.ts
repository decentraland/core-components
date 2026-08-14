import { createServer } from 'net'
import { ILoggerComponent, IMetricsComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { ICacheStorageComponent, sleep } from '@dcl/core-commons'
import { createServerComponent, Router } from '@dcl/http-server'
import { createInMemoryCacheComponent } from '@dcl/memory-cache-component'
import { createRedisComponent } from '@dcl/redis-component'
import { createRateLimiterComponent } from '../src/component'
import { metricDeclarations, RateLimitOutcome } from '../src/metrics'
import { IRateLimiterComponent, RateLimitDisclosure, RateLimiterOptions } from '../src/types'

// The whole chain over a real socket: connection -> http-server -> router -> limiter -> cache. The unit
// suite runs against a cache double and a hand-built context, so nothing there proves that the peer
// address actually arrives, that the router's matched route reaches the bucket, or that either real
// backend honours the TTL-on-create rule the limiter depends on.
const REDIS_URL = process.env.REDIS_URL

type Backend = {
  label: string
  create: () => Promise<ICacheStorageComponent>
  dispose: (cache: ICacheStorageComponent) => Promise<void>
}

function createLogs(): { logs: ILoggerComponent; lines: string[] } {
  const lines: string[] = []
  const record = (message: unknown) => {
    lines.push(String(message))
  }
  return {
    lines,
    logs: { getLogger: () => ({ info: record, debug: () => {}, log: record, warn: record, error: record }) }
  }
}

function createMetrics(): {
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  increments: [string, Record<string, string>][]
} {
  const increments: [string, Record<string, string>][] = []
  return {
    increments,
    metrics: {
      increment: (name, labels) => {
        increments.push([name as string, (labels ?? {}) as Record<string, string>])
      },
      decrement: () => {},
      observe: () => {},
      startTimer: () => ({ end: () => {} }),
      reset: () => {},
      resetAll: () => {},
      getValue: async () => ({}) as never
    }
  }
}

const backends: Backend[] = [
  {
    label: 'the in-memory cache',
    create: async () => createInMemoryCacheComponent({ max: 1000 }),
    dispose: async () => {}
  },
  // Skipped rather than failed when REDIS_URL is unset, so a local run needs no server.
  ...(REDIS_URL
    ? [
        {
          label: 'redis',
          create: async () => {
            const cache = await createRedisComponent(REDIS_URL, { logs: createLogs().logs })
            await cache[START_COMPONENT]!({} as never)
            // Counters outlive a run: their window is still open, and per-identity phases mean they no
            // longer share a boundary. Clear the namespace or the next run inherits the last one.
            for (const key of await cache.keys('rl-integration:*')) await cache.remove(key)
            return cache
          },
          dispose: async (cache: ICacheStorageComponent) => {
            for (const key of await cache.keys('rl-integration:*')) await cache.remove(key)
            await cache[STOP_COMPONENT]!()
          }
        }
      ]
    : [])
]

// Binding to port 0 and reading back what the OS assigned avoids both a hard-coded port and a
// collision with a parallel jest worker.
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

describe.each(backends)('when rate limiting a real server backed by $label', ({ create, dispose }: Backend) => {
  let cache: ICacheStorageComponent
  let metricIncrements: [string, Record<string, string>][]
  let logLines: string[]
  let stop: (() => Promise<void>) | undefined
  let origin: string

  // Each test mounts the shape it needs, so the routes and the policy stay next to the assertions.
  async function startServer(
    options: RateLimiterOptions,
    build: (router: Router<{}>, limiter: IRateLimiterComponent) => void
  ) {
    const port = await freePort()
    const config = {
      getString: async () => '127.0.0.1',
      requireString: async () => '127.0.0.1',
      getNumber: async () => port,
      requireNumber: async () => port
    }
    const logging = createLogs()
    const metrics = createMetrics()
    logLines = logging.lines
    metricIncrements = metrics.increments

    const rateLimiter = createRateLimiterComponent(
      { cache, logs: logging.logs, metrics: metrics.metrics },
      { keyPrefix: 'rl-integration', ...options }
    )

    const server = await createServerComponent({ config: config as never, logs: logging.logs }, {})
    const router = new Router<{}>()
    build(router, rateLimiter)
    server.use(router.middleware())
    server.setContext({})
    await server[START_COMPONENT]!({} as never)

    origin = `http://127.0.0.1:${port}`
    stop = async () => {
      await server[STOP_COMPONENT]!()
    }
  }

  async function get(path: string, headers?: Record<string, string>): Promise<Response> {
    return fetch(`${origin}${path}`, { headers })
  }

  beforeEach(async () => {
    stop = undefined
    cache = await create()
  })

  afterEach(async () => {
    if (stop) await stop()
    await dispose(cache)
  })

  describe('and no trusted header is configured', () => {
    let statuses: number[]

    beforeEach(async () => {
      await startServer({ max: 3, windowSeconds: 60 }, (router, limiter) => {
        router.get('/v1/notes', limiter.withRateLimitMiddleware(), async () => ({ status: 200, body: { ok: true } }))
      })
      statuses = []
      for (let i = 0; i < 4; i++) statuses.push((await get('/v1/notes')).status)
    })

    it('should count each connection and reject once over the limit', () => {
      expect(statuses).toEqual([200, 200, 200, 429])
    })

    it('should key on the peer address the server reported rather than the shared fallback', () => {
      // The client is this process, so the address is loopback — which is what proves it arrived at all.
      expect(metricIncrements).toEqual(
        expect.arrayContaining([['rate_limiter_requests_total', expect.objectContaining({ key_source: 'socket' })]])
      )
    })

    it('should not log the rejection', () => {
      expect(logLines.filter(line => line.toLowerCase().includes('rejected'))).toHaveLength(0)
    })
  })

  describe('and two endpoints share one limiter', () => {
    let notesStatuses: number[]
    let otherStatus: number

    beforeEach(async () => {
      await startServer({ max: 2, windowSeconds: 60 }, (router, limiter) => {
        router.get('/v1/notes', limiter.withRateLimitMiddleware(), async () => ({ status: 200 }))
        router.get('/v1/other', limiter.withRateLimitMiddleware(), async () => ({ status: 200 }))
      })
      notesStatuses = []
      for (let i = 0; i < 3; i++) notesStatuses.push((await get('/v1/notes')).status)
      otherStatus = (await get('/v1/other')).status
    })

    it('should exhaust the endpoint that was hit', () => {
      expect(notesStatuses).toEqual([200, 200, 429])
    })

    it('should leave the other endpoint its own allowance', () => {
      expect(otherStatus).toBe(200)
    })

    it('should bucket them by the route the router matched', () => {
      const buckets = metricIncrements
        .filter(([name]) => name === 'rate_limiter_requests_total')
        .map(([, labels]) => labels.bucket)
      expect(new Set(buckets)).toEqual(new Set(['/v1/notes 2p60', '/v1/other 2p60']))
    })
  })

  describe('and a route carries a path parameter', () => {
    beforeEach(async () => {
      await startServer({ max: 5, windowSeconds: 60 }, (router, limiter) => {
        router.get('/v1/notes/:id', limiter.withRateLimitMiddleware(), async () => ({ status: 200 }))
      })
      await get('/v1/notes/abc-123')
      await get('/v1/notes/def-456')
    })

    it('should bucket both ids together, so the bucket count follows routes not ids', () => {
      const buckets = metricIncrements
        .filter(([name]) => name === 'rate_limiter_requests_total')
        .map(([, labels]) => labels.bucket)
      expect(buckets).toEqual(['/v1/notes/{id} 5p60', '/v1/notes/{id} 5p60'])
    })
  })

  describe('and clients are identified by a trusted header', () => {
    let firstClient: number[]
    let secondClientStatus: number

    beforeEach(async () => {
      // Every loopback connection reports 127.0.0.1, so telling clients apart locally needs the header
      // path — which is the deployment shape anyway.
      await startServer({ max: 2, windowSeconds: 60, trustedClientIpHeader: 'x-forwarded-for' }, (router, limiter) => {
        router.get('/v1/notes', limiter.withRateLimitMiddleware(), async () => ({ status: 200 }))
      })
      firstClient = []
      for (let i = 0; i < 3; i++) {
        firstClient.push((await get('/v1/notes', { 'x-forwarded-for': '203.0.113.7' })).status)
      }
      secondClientStatus = (await get('/v1/notes', { 'x-forwarded-for': '198.51.100.4' })).status
    })

    it('should exhaust the first client', () => {
      expect(firstClient).toEqual([200, 200, 429])
    })

    it('should leave a different client unaffected', () => {
      expect(secondClientStatus).toBe(200)
    })
  })

  describe('and the limit is exceeded with limit headers enabled', () => {
    let rejected: Response

    beforeEach(async () => {
      await startServer({ max: 1, windowSeconds: 60, disclosure: RateLimitDisclosure.ON_LIMIT }, (router, limiter) => {
        router.get('/v1/notes', limiter.withRateLimitMiddleware(), async () => ({ status: 200 }))
      })
      await get('/v1/notes')
      rejected = await get('/v1/notes')
    })

    it('should answer 429', () => {
      expect(rejected.status).toBe(429)
    })

    it('should carry a positive Retry-After in seconds', () => {
      expect(Number(rejected.headers.get('retry-after'))).toBeGreaterThan(0)
    })

    it('should carry the limit triplet, with the reset as delta seconds', () => {
      expect(rejected.headers.get('ratelimit-limit')).toBe('1')
      expect(rejected.headers.get('ratelimit-remaining')).toBe('0')
      expect(rejected.headers.get('ratelimit-reset')).toBe(rejected.headers.get('retry-after'))
    })

    it('should carry the generic body', async () => {
      await expect(rejected.json()).resolves.toEqual({ ok: false, message: 'Too many requests' })
    })

    it('should record the rejection as a metric', () => {
      expect(metricIncrements).toEqual(
        expect.arrayContaining([
          ['rate_limiter_requests_total', expect.objectContaining({ outcome: RateLimitOutcome.LIMITED })]
        ])
      )
    })
  })

  describe('and disclosure is set to none', () => {
    let rejected: Response

    beforeEach(async () => {
      await startServer({ max: 1, windowSeconds: 60, disclosure: RateLimitDisclosure.NONE }, (router, limiter) => {
        router.get('/v1/notes', limiter.withRateLimitMiddleware(), async () => ({ status: 200 }))
      })
      await get('/v1/notes')
      rejected = await get('/v1/notes')
    })

    it('should still answer 429', () => {
      expect(rejected.status).toBe(429)
    })

    it('should send no rate limit headers at all', () => {
      expect(rejected.headers.get('retry-after')).toBeNull()
      expect(rejected.headers.get('ratelimit-limit')).toBeNull()
    })

    it('should send no body', async () => {
      await expect(rejected.text()).resolves.toBe('')
    })
  })

  describe('and the window elapses', () => {
    let beforeRollover: number[]
    let afterRollover: number

    beforeEach(async () => {
      // Real time and a one-second window. This is the assertion no amount of fake-timer work can
      // make: that the real backend expires the counter rather than sliding its deadline.
      await startServer({ max: 2, windowSeconds: 1 }, (router, limiter) => {
        router.get('/v1/notes', limiter.withRateLimitMiddleware(), async () => ({ status: 200 }))
      })
      beforeRollover = []
      for (let i = 0; i < 3; i++) beforeRollover.push((await get('/v1/notes')).status)
      await sleep(1300)
      afterRollover = (await get('/v1/notes')).status
    })

    it('should reject once the allowance is spent', () => {
      expect(beforeRollover).toEqual([200, 200, 429])
    })

    it('should serve again in the next window', () => {
      expect(afterRollover).toBe(200)
    })
  })

  describe('and two limiter instances share one store', () => {
    let statuses: number[]

    beforeEach(async () => {
      // Stands in for two replicas: the second instance must see the first one's count. On redis that
      // is the whole point of the shared store; here it also pins that the key derivation is
      // deterministic across instances rather than carrying per-instance state.
      await startServer({ max: 2, windowSeconds: 60, trustedClientIpHeader: 'x-forwarded-for' }, (router, limiter) => {
        const second = createRateLimiterComponent(
          { cache, logs: createLogs().logs, metrics: createMetrics().metrics },
          {
            keyPrefix: 'rl-integration',
            max: 2,
            windowSeconds: 60,
            trustedClientIpHeader: 'x-forwarded-for'
          }
        )
        router.get('/a', limiter.withRateLimitMiddleware({ name: 'shared' }), async () => ({ status: 200 }))
        router.get('/b', second.withRateLimitMiddleware({ name: 'shared' }), async () => ({ status: 200 }))
      })
      statuses = []
      for (const path of ['/a', '/b', '/a']) {
        statuses.push((await get(path, { 'x-forwarded-for': '203.0.113.7' })).status)
      }
    })

    it('should count across both instances rather than giving each its own allowance', () => {
      expect(statuses).toEqual([200, 200, 429])
    })
  })

  describe('and a route is skipped', () => {
    let healthStatuses: number[]

    beforeEach(async () => {
      await startServer({ max: 1, windowSeconds: 60, skip: '/health/live' }, (router, limiter) => {
        router.get('/health/live', limiter.withRateLimitMiddleware(), async () => ({ status: 200 }))
      })
      healthStatuses = []
      for (let i = 0; i < 3; i++) healthStatuses.push((await get('/health/live')).status)
    })

    it('should never reject it', () => {
      expect(healthStatuses).toEqual([200, 200, 200])
    })

    it('should never count it', () => {
      expect(metricIncrements).toHaveLength(0)
    })
  })

  describe('when a caller varies the request method to get a second allowance', () => {
    let statuses: string[]

    beforeEach(async () => {
      // HEAD routes to a GET handler and executes it, so a per-method bucket handed every GET endpoint
      // twice its limit — and a route serving all methods one limit each. The method is the caller's
      // choice, so it must not be part of the bucket.
      await startServer({ max: 2, windowSeconds: 60 }, (router, limiter) => {
        router.get('/v1/notes', limiter.withRateLimitMiddleware(), async () => ({ status: 200 }))
      })
      statuses = []
      for (const method of ['GET', 'GET', 'HEAD', 'GET']) {
        const response = await fetch(`${origin}/v1/notes`, { method })
        statuses.push(`${method}:${response.status}`)
      }
    })

    it('should count HEAD against the same allowance as GET', () => {
      expect(statuses).toEqual(['GET:200', 'GET:200', 'HEAD:429', 'GET:429'])
    })

    it('should keep them in one bucket', () => {
      const buckets = metricIncrements
        .filter(([name]) => name === 'rate_limiter_requests_total')
        .map(([, labels]) => labels.bucket)
      expect(new Set(buckets).size).toBe(1)
    })
  })
})
