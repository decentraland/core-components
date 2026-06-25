import createHttpError from 'http-errors'
import { createTestServerComponent } from '../src'
import { instrumentHttpServerWithPromClientRegistry } from '../src/metrics'

function createMockConfig(values: Record<string, string | undefined>) {
  return { getString: jest.fn(async (key: string) => values[key]) } as any
}

function createMockMetrics() {
  return {
    startTimer: jest.fn().mockReturnValue({ end: jest.fn() }),
    observe: jest.fn(),
    increment: jest.fn(),
    resetAll: jest.fn()
  } as any
}

function createMockRegistry() {
  return {
    contentType: 'text/plain; version=0.0.4',
    metrics: jest.fn().mockResolvedValue('metrics_body')
  }
}

describe('when instrumenting the http server with the metrics endpoint', () => {
  let server: ReturnType<typeof createTestServerComponent>
  let metrics: ReturnType<typeof createMockMetrics>
  let registry: ReturnType<typeof createMockRegistry>

  beforeEach(() => {
    server = createTestServerComponent()
    metrics = createMockMetrics()
    registry = createMockRegistry()
  })

  describe('and no bearer token is configured', () => {
    beforeEach(async () => {
      await instrumentHttpServerWithPromClientRegistry({
        server,
        config: createMockConfig({}),
        metrics,
        registry: registry as any
      })
    })

    it('should respond with the serialized metrics and the registry content type', async () => {
      const response = await server.fetch('/metrics')

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('metrics_body')
      expect(response.headers.get('content-type')).toBe('text/plain; version=0.0.4')
    })
  })

  describe('and a bearer token is configured', () => {
    beforeEach(async () => {
      await instrumentHttpServerWithPromClientRegistry({
        server,
        config: createMockConfig({ WKC_METRICS_BEARER_TOKEN: 'secret-token' }),
        metrics,
        registry: registry as any
      })
    })

    describe('and the request has no authorization header', () => {
      it('should respond with 401 and not serialize the metrics', async () => {
        const response = await server.fetch('/metrics')

        expect(response.status).toBe(401)
        expect(registry.metrics).not.toHaveBeenCalled()
      })
    })

    describe('and the bearer token does not match', () => {
      it('should respond with 401 and not serialize the metrics', async () => {
        const response = await server.fetch('/metrics', { headers: { authorization: 'Bearer wrong-token' } })

        expect(response.status).toBe(401)
        expect(registry.metrics).not.toHaveBeenCalled()
      })
    })

    describe('and the authorization scheme is not Bearer', () => {
      it('should respond with 401 and not serialize the metrics', async () => {
        const response = await server.fetch('/metrics', { headers: { authorization: 'Basic secret-token' } })

        expect(response.status).toBe(401)
        expect(registry.metrics).not.toHaveBeenCalled()
      })
    })

    describe('and the provided token is a prefix of the expected token', () => {
      it('should respond with 401 without throwing on the length mismatch', async () => {
        const response = await server.fetch('/metrics', { headers: { authorization: 'Bearer secret' } })

        expect(response.status).toBe(401)
        expect(registry.metrics).not.toHaveBeenCalled()
      })
    })

    describe('and the bearer token matches', () => {
      it('should respond with the serialized metrics', async () => {
        const response = await server.fetch('/metrics', { headers: { authorization: 'Bearer secret-token' } })

        expect(response.status).toBe(200)
        expect(await response.text()).toBe('metrics_body')
      })
    })
  })
})

describe('when recording the request metrics for a handler response', () => {
  let server: ReturnType<typeof createTestServerComponent>
  let metrics: ReturnType<typeof createMockMetrics>
  let registry: ReturnType<typeof createMockRegistry>

  function totalLabelsFor(method: string) {
    const call = metrics.increment.mock.calls.find(
      (args: any[]) => args[0] === 'http_requests_total' && args[1].method === method
    )
    return call?.[1]
  }

  beforeEach(async () => {
    server = createTestServerComponent()
    metrics = createMockMetrics()
    registry = createMockRegistry()
    await instrumentHttpServerWithPromClientRegistry({
      server,
      config: createMockConfig({}),
      metrics,
      registry: registry as any
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the handler returns a response with a status', () => {
    beforeEach(async () => {
      server.use(async () => ({ status: 201, body: 'created' }))
      await server.fetch('/resource', { method: 'POST' })
    })

    it('should label http_requests_total with the returned status code', () => {
      expect(totalLabelsFor('POST')).toEqual(expect.objectContaining({ code: 201 }))
    })
  })

  describe('and the handler throws an http-error', () => {
    beforeEach(async () => {
      server.use(async () => {
        throw createHttpError(413, 'Payload Too Large')
      })
      await server.fetch('/resource', { method: 'POST' })
    })

    it('should label http_requests_total with the error status code rather than 200', () => {
      expect(totalLabelsFor('POST')).toEqual(expect.objectContaining({ code: 413 }))
    })
  })

  describe('and the handler throws a plain error', () => {
    beforeEach(async () => {
      server.use(async () => {
        throw new Error('boom')
      })
      await server.fetch('/resource', { method: 'POST' })
    })

    it('should label http_requests_total with a 500 status code', () => {
      expect(totalLabelsFor('POST')).toEqual(expect.objectContaining({ code: 500 }))
    })
  })
})
