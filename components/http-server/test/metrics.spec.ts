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
