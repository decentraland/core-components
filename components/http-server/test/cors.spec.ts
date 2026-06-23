import { Readable } from 'stream'
import { corsHeaders, createCorsMiddleware, handleOptions } from '../src/cors'
import { fromNativeResponse } from '../src/helpers'
import { IHttpServerComponent } from '@dcl/core-commons'

function contextForRequest(request: Request): IHttpServerComponent.DefaultContext {
  return { request, url: new URL(request.url) } as IHttpServerComponent.DefaultContext
}

describe('when handling a request through the CORS middleware', () => {
  let next: jest.MockedFunction<() => Promise<IHttpServerComponent.IResponse>>

  beforeEach(() => {
    next = jest.fn()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and it is an OPTIONS preflight while preflightContinue is disabled', () => {
    let handler: IHttpServerComponent.IRequestHandler<{}>
    let context: IHttpServerComponent.DefaultContext

    beforeEach(() => {
      handler = createCorsMiddleware<{}>({ origin: '*', methods: ['GET', 'POST'], maxAge: 600 })
      context = contextForRequest(
        new Request('http://localhost/resource', { method: 'OPTIONS', headers: { origin: 'http://example.com' } })
      )
    })

    it('should respond with the default 204 success status', async () => {
      const response = await handler(context, next)
      expect(response.status).toBe(204)
    })

    it('should not delegate to the next handler', async () => {
      await handler(context, next)
      expect(next).not.toHaveBeenCalled()
    })

    it('should allow the configured methods', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Allow-Methods')).toBe('GET,POST')
    })

    it('should advertise the configured max age', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Max-Age')).toBe('600')
    })
  })

  describe('and it is an OPTIONS preflight while preflightContinue is enabled', () => {
    let handler: IHttpServerComponent.IRequestHandler<{}>
    let context: IHttpServerComponent.DefaultContext

    beforeEach(() => {
      handler = createCorsMiddleware<{}>({ preflightContinue: true })
      context = contextForRequest(new Request('http://localhost/resource', { method: 'OPTIONS' }))
      next.mockResolvedValueOnce({ status: 200 })
    })

    it('should delegate to the next handler', async () => {
      await handler(context, next)
      expect(next).toHaveBeenCalled()
    })
  })

  describe('and it is a non-OPTIONS request carrying an Origin header', () => {
    let handler: IHttpServerComponent.IRequestHandler<{}>
    let context: IHttpServerComponent.DefaultContext

    beforeEach(() => {
      handler = createCorsMiddleware<{}>({ origin: '*', credentials: true })
      context = contextForRequest(
        new Request('http://localhost/data', { method: 'GET', headers: { origin: 'http://example.com' } })
      )
      next.mockResolvedValueOnce({ status: 201, headers: new Headers({ 'content-type': 'application/json' }) })
    })

    it('should delegate to the next handler', async () => {
      await handler(context, next)
      expect(next).toHaveBeenCalled()
    })

    it('should preserve the status returned by the next handler', async () => {
      const response = await handler(context, next)
      expect(response.status).toBe(201)
    })

    it('should allow the requesting origin', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('should allow credentials when configured', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Allow-Credentials')).toBe('true')
    })
  })

  describe('and the next handler returns a fromNativeResponse-adapted Response', () => {
    let handler: IHttpServerComponent.IRequestHandler<{}>
    let context: IHttpServerComponent.DefaultContext

    beforeEach(() => {
      handler = createCorsMiddleware<{}>({ origin: '*' })
      context = contextForRequest(
        new Request('http://localhost/data', { method: 'GET', headers: { origin: 'http://example.com' } })
      )
      next.mockResolvedValueOnce(fromNativeResponse(new Response('payload', { status: 201 })))
    })

    it('should preserve the status through CORS', async () => {
      const response = await handler(context, next)
      expect(response.status).toBe(201)
    })

    it('should preserve the body through CORS', async () => {
      const response = await handler(context, next)
      const chunks: Buffer[] = []
      for await (const chunk of response.body as Readable) {
        chunks.push(Buffer.from(chunk))
      }
      expect(Buffer.concat(chunks).toString()).toBe('payload')
    })

    it('should still add the CORS origin header', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Allow-Origin')).toBe('*')
    })
  })

  describe('and the next handler returns a raw native Response while an Origin is present', () => {
    let handler: IHttpServerComponent.IRequestHandler<{}>
    let context: IHttpServerComponent.DefaultContext

    beforeEach(() => {
      handler = createCorsMiddleware<{}>({ origin: '*' })
      context = contextForRequest(
        new Request('http://localhost/data', { method: 'GET', headers: { origin: 'http://example.com' } })
      )
      // Simulate a handler returning a native Response via a type-escape; CORS must
      // still preserve its status/body rather than spreading the prototype getters away.
      next.mockResolvedValueOnce(new Response('payload', { status: 201 }) as any)
    })

    it('should preserve the status', async () => {
      const response = await handler(context, next)
      expect(response.status).toBe(201)
    })

    it('should preserve the body', async () => {
      const response = await handler(context, next)
      const chunks: Buffer[] = []
      for await (const chunk of response.body as Readable) {
        chunks.push(Buffer.from(chunk))
      }
      expect(Buffer.concat(chunks).toString()).toBe('payload')
    })

    it('should add the CORS origin header', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Allow-Origin')).toBe('*')
    })
  })
})

describe('when resolving the allowed origin for an actual request', () => {
  let next: jest.MockedFunction<() => Promise<IHttpServerComponent.IResponse>>

  beforeEach(() => {
    next = jest.fn()
    next.mockResolvedValue({ status: 200, headers: new Headers() })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and the origin is configured as a fixed string', () => {
    let handler: IHttpServerComponent.IRequestHandler<{}>
    let context: IHttpServerComponent.DefaultContext

    beforeEach(() => {
      handler = createCorsMiddleware<{}>({ origin: 'http://allowed.example' })
      context = contextForRequest(
        new Request('http://localhost/', { headers: { origin: 'http://allowed.example' } })
      )
    })

    it('should echo the configured origin', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Allow-Origin')).toBe('http://allowed.example')
    })
  })

  describe('and the origin is in the configured allow-list', () => {
    let handler: IHttpServerComponent.IRequestHandler<{}>
    let context: IHttpServerComponent.DefaultContext

    beforeEach(() => {
      handler = createCorsMiddleware<{}>({ origin: ['http://a.example', /\.b\.example$/] })
      context = contextForRequest(new Request('http://localhost/', { headers: { origin: 'http://a.example' } }))
    })

    it('should reflect the requesting origin', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Allow-Origin')).toBe('http://a.example')
    })
  })

  describe('and the origin matches a configured pattern', () => {
    let handler: IHttpServerComponent.IRequestHandler<{}>
    let context: IHttpServerComponent.DefaultContext

    beforeEach(() => {
      handler = createCorsMiddleware<{}>({ origin: [/\.b\.example$/] })
      context = contextForRequest(new Request('http://localhost/', { headers: { origin: 'http://sub.b.example' } }))
    })

    it('should reflect the requesting origin', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Allow-Origin')).toBe('http://sub.b.example')
    })
  })

  describe('and the origin is not allowed', () => {
    let handler: IHttpServerComponent.IRequestHandler<{}>
    let context: IHttpServerComponent.DefaultContext

    beforeEach(() => {
      handler = createCorsMiddleware<{}>({ origin: ['http://a.example'] })
      context = contextForRequest(new Request('http://localhost/', { headers: { origin: 'http://evil.example' } }))
    })

    it('should reject the requesting origin', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Allow-Origin')).toBe('false')
    })
  })

  describe('and exposed headers are configured', () => {
    let handler: IHttpServerComponent.IRequestHandler<{}>
    let context: IHttpServerComponent.DefaultContext

    beforeEach(() => {
      handler = createCorsMiddleware<{}>({ origin: '*', exposedHeaders: ['ETag', 'X-Total'] })
      context = contextForRequest(new Request('http://localhost/', { headers: { origin: 'http://x.example' } }))
    })

    it('should expose the configured headers', async () => {
      const response = await handler(context, next)
      expect((response.headers as Headers).get('Access-Control-Expose-Headers')).toBe('ETag,X-Total')
    })
  })
})

describe('when configuring allowed headers on a preflight request', () => {
  let next: jest.MockedFunction<() => Promise<IHttpServerComponent.IResponse>>
  let handler: IHttpServerComponent.IRequestHandler<{}>
  let context: IHttpServerComponent.DefaultContext

  beforeEach(() => {
    next = jest.fn()
    handler = createCorsMiddleware<{}>({ origin: '*', allowedHeaders: ['X-Custom', 'X-Other'] })
    context = contextForRequest(
      new Request('http://localhost/', { method: 'OPTIONS', headers: { origin: 'http://x.example' } })
    )
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should allow the configured request headers', async () => {
    const response = await handler(context, next)
    expect((response.headers as Headers).get('Access-Control-Allow-Headers')).toBe('X-Custom,X-Other')
  })
})

describe('when building an OPTIONS response directly', () => {
  it('should carry the default permissive Access-Control-Allow-Origin header', () => {
    const response = handleOptions()
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(corsHeaders['Access-Control-Allow-Origin'])
  })
})
