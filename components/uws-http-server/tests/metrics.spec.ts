import {
  createMetricsHandler,
  getDefaultHttpMetrics,
  onRequestEnd,
  onRequestStart
} from '../src/metrics'

type MockResponse = {
  writeStatus: jest.Mock
  writeHeader: jest.Mock
  end: jest.Mock
  onAborted: jest.Mock
}

function createMockResponse(): MockResponse {
  return {
    writeStatus: jest.fn(),
    writeHeader: jest.fn(),
    end: jest.fn(),
    onAborted: jest.fn()
  }
}

function createMockConfig(values: Record<string, string | undefined>) {
  return {
    getString: jest.fn(async (key: string) => values[key])
  }
}

describe('when getting the default http metrics', () => {
  it('should return the request duration, total and size metric definitions', () => {
    const result = getDefaultHttpMetrics()

    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(['http_request_duration_seconds', 'http_requests_total', 'http_request_size_bytes'])
    )
  })
})

describe('when creating the metrics handler', () => {
  let metrics: { resetAll: jest.Mock }
  let registry: { contentType: string; metrics: jest.Mock }
  let res: MockResponse
  let req: { getHeader: jest.Mock }

  beforeEach(() => {
    metrics = { resetAll: jest.fn() }
    registry = { contentType: 'text/plain; version=0.0.4', metrics: jest.fn().mockResolvedValue('metrics_body') }
    res = createMockResponse()
    req = { getHeader: jest.fn().mockReturnValue('') }
  })

  describe('and no public path is configured', () => {
    it('should default the path to /metrics', async () => {
      const config = createMockConfig({})

      const { path } = await createMetricsHandler({ config, metrics } as any, registry as any)

      expect(path).toBe('/metrics')
    })
  })

  describe('and a public path is configured', () => {
    it('should use the configured path', async () => {
      const config = createMockConfig({ WKC_METRICS_PUBLIC_PATH: '/internal/metrics' })

      const { path } = await createMetricsHandler({ config, metrics } as any, registry as any)

      expect(path).toBe('/internal/metrics')
    })
  })

  describe('and no bearer token is configured', () => {
    let handler: (res: any, req: any) => Promise<void>

    beforeEach(async () => {
      const config = createMockConfig({})
      handler = (await createMetricsHandler({ config, metrics } as any, registry as any)).handler
    })

    it('should respond with the serialized metrics and the registry content type', async () => {
      await handler(res, req)

      expect(res.writeStatus).toHaveBeenCalledWith('200 OK')
      expect(res.writeHeader).toHaveBeenCalledWith('content-type', 'text/plain; version=0.0.4')
      expect(res.end).toHaveBeenCalledWith('metrics_body')
    })

    it('should register an onAborted handler', async () => {
      await handler(res, req)

      expect(res.onAborted).toHaveBeenCalledTimes(1)
    })
  })

  describe('and a bearer token is configured', () => {
    let handler: (res: any, req: any) => Promise<void>

    beforeEach(async () => {
      const config = createMockConfig({ WKC_METRICS_BEARER_TOKEN: 'secret-token' })
      handler = (await createMetricsHandler({ config, metrics } as any, registry as any)).handler
    })

    describe('and the request has no authorization header', () => {
      beforeEach(() => {
        req.getHeader.mockReturnValue('')
      })

      it('should respond with 401 Unauthorized and not serialize the metrics', async () => {
        await handler(res, req)

        expect(res.writeStatus).toHaveBeenCalledWith('401 Unauthorized')
        expect(res.end).toHaveBeenCalledWith()
        expect(registry.metrics).not.toHaveBeenCalled()
      })
    })

    describe('and the authorization scheme is not Bearer', () => {
      beforeEach(() => {
        req.getHeader.mockReturnValue('Basic secret-token')
      })

      it('should respond with 401 Unauthorized', async () => {
        await handler(res, req)

        expect(res.writeStatus).toHaveBeenCalledWith('401 Unauthorized')
        expect(registry.metrics).not.toHaveBeenCalled()
      })
    })

    describe('and the bearer token does not match', () => {
      beforeEach(() => {
        req.getHeader.mockReturnValue('Bearer wrong-token')
      })

      it('should respond with 401 Unauthorized', async () => {
        await handler(res, req)

        expect(res.writeStatus).toHaveBeenCalledWith('401 Unauthorized')
        expect(registry.metrics).not.toHaveBeenCalled()
      })
    })

    describe('and the bearer token matches', () => {
      beforeEach(() => {
        req.getHeader.mockReturnValue('Bearer secret-token')
      })

      it('should respond with the serialized metrics', async () => {
        await handler(res, req)

        expect(res.writeStatus).toHaveBeenCalledWith('200 OK')
        expect(res.end).toHaveBeenCalledWith('metrics_body')
      })
    })
  })

  describe('and the client disconnects while the metrics are being computed', () => {
    let handler: (res: any, req: any) => Promise<void>
    let resolveMetrics: (value: string) => void

    beforeEach(async () => {
      const config = createMockConfig({})
      registry.metrics.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveMetrics = resolve
        })
      )
      handler = (await createMetricsHandler({ config, metrics } as any, registry as any)).handler
    })

    it('should not write to the aborted response', async () => {
      const handlerPromise = handler(res, req)

      // Simulate the client aborting before the metrics body resolves
      const onAbortedCallback = res.onAborted.mock.calls[0][0]
      onAbortedCallback()
      resolveMetrics('metrics_body')
      await handlerPromise

      expect(res.writeStatus).not.toHaveBeenCalled()
      expect(res.end).not.toHaveBeenCalled()
    })
  })

  describe('and metrics rotation is enabled', () => {
    let handler: (res: any, req: any) => Promise<void>

    beforeEach(async () => {
      const config = createMockConfig({ WKC_METRICS_RESET_AT_NIGHT: 'true' })
      handler = (await createMetricsHandler({ config, metrics } as any, registry as any)).handler
    })

    it('should still serve the current metrics before any reset', async () => {
      await handler(res, req)

      expect(res.end).toHaveBeenCalledWith('metrics_body')
    })
  })
})

describe('when a request starts', () => {
  let metrics: { startTimer: jest.Mock }
  let end: jest.Mock

  beforeEach(() => {
    end = jest.fn()
    metrics = { startTimer: jest.fn().mockReturnValue({ end }) }
  })

  it('should start the request duration timer with the method and handler labels', () => {
    const result = onRequestStart(metrics as any, 'GET', '/test')

    expect(metrics.startTimer).toHaveBeenCalledWith('http_request_duration_seconds', {
      method: 'GET',
      handler: '/test'
    })
    expect(result.labels).toEqual({ method: 'GET', handler: '/test' })
    expect(result.end).toBe(end)
  })

  describe('and the timer cannot be started', () => {
    beforeEach(() => {
      metrics.startTimer.mockReturnValue(undefined)
    })

    it('should fall back to a no-op end function', () => {
      const result = onRequestStart(metrics as any, 'GET', '/test')

      expect(() => result.end({})).not.toThrow()
    })
  })
})

describe('when a request ends', () => {
  let metrics: { increment: jest.Mock }
  let end: jest.Mock

  beforeEach(() => {
    end = jest.fn()
    metrics = { increment: jest.fn() }
  })

  it('should increment the total requests counter with the status code label', () => {
    onRequestEnd(metrics as any, { method: 'GET', handler: '/test' }, 200, end)

    expect(metrics.increment).toHaveBeenCalledWith('http_requests_total', {
      method: 'GET',
      handler: '/test',
      code: 200
    })
  })

  it('should end the duration timer with the status code label', () => {
    onRequestEnd(metrics as any, { method: 'GET', handler: '/test' }, 200, end)

    expect(end).toHaveBeenCalledWith({ method: 'GET', handler: '/test', code: 200 })
  })
})
