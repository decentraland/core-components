import {
  createBodySizeLimiter,
  exceedsContentLength,
  getRequestFromNodeMessage,
  getServer,
  normalizeResponseBody,
  NormalizedResponse,
  success
} from '../src/logic'
import type { RequestListener, ServerResponse } from 'http'
import * as https from 'https'
import { Readable } from 'stream'

describe('when normalizing a handler response that is already a native Response', () => {
  let request: Request
  let normalized: NormalizedResponse

  describe('and the Response has a body', () => {
    beforeEach(() => {
      request = new Request('http://localhost/resource', { method: 'GET' })
      normalized = normalizeResponseBody(
        request,
        new Response('hello body', { status: 418, headers: { 'x-test': 'yes' } }) as any
      )
    })

    it('should carry over the status code', () => {
      expect(normalized.status).toBe(418)
    })

    it('should carry over the response headers', () => {
      expect(normalized.headers.get('x-test')).toBe('yes')
    })

    it('should expose the body as a Node Readable', () => {
      expect(normalized.body).toBeInstanceOf(Readable)
    })

    it('should preserve the body contents', async () => {
      const chunks: Buffer[] = []
      for await (const chunk of normalized.body as Readable) {
        chunks.push(Buffer.from(chunk))
      }
      expect(Buffer.concat(chunks).toString()).toBe('hello body')
    })
  })

  describe('and the Response has no body', () => {
    beforeEach(() => {
      request = new Request('http://localhost/resource', { method: 'GET' })
      normalized = normalizeResponseBody(request, new Response(null, { status: 204 }) as any)
    })

    it('should leave the normalized body undefined', () => {
      expect(normalized.body).toBeUndefined()
    })
  })

  describe('and the Response carries a stale content-encoding header', () => {
    beforeEach(() => {
      request = new Request('http://localhost/resource', { method: 'GET' })
      normalized = normalizeResponseBody(
        request,
        new Response('decoded', { status: 200, headers: { 'content-encoding': 'gzip' } }) as any
      )
    })

    it('should drop the content-encoding header so the decoded body is not double-decoded', () => {
      expect(normalized.headers.has('content-encoding')).toBe(false)
    })
  })
})

describe('when writing a successful response with multiple Set-Cookie headers', () => {
  let res: { statusCode?: number; statusMessage?: string; setHeader: jest.Mock; end: jest.Mock }

  beforeEach(() => {
    res = { setHeader: jest.fn(), end: jest.fn() }
    const headers = new Headers()
    headers.append('set-cookie', 'a=1; Path=/')
    headers.append('set-cookie', 'b=2; Path=/')
    success({ status: 200, headers }, res as unknown as ServerResponse)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should emit every cookie as a single array-valued Set-Cookie header', () => {
    expect(res.setHeader).toHaveBeenCalledWith('set-cookie', ['a=1; Path=/', 'b=2; Path=/'])
  })
})

describe('when building a request from a Node message', () => {
  describe('and a header carries multiple values', () => {
    let nodeMessage: any

    beforeEach(() => {
      nodeMessage = { method: 'GET', url: '/resource', headers: { 'x-multi': ['one', 'two'] } }
    })

    it('should append every value into the request headers', () => {
      const request = getRequestFromNodeMessage(nodeMessage, '0.0.0.0')
      expect(request.headers.get('x-multi')).toBe('one, two')
    })
  })

  describe('and the request method allows a body', () => {
    let nodeMessage: any

    beforeEach(() => {
      nodeMessage = Object.assign(Readable.from([Buffer.from('payload')]), {
        method: 'POST',
        url: '/resource',
        headers: {}
      })
    })

    it('should attach a streaming request body', () => {
      const request = getRequestFromNodeMessage(nodeMessage, '0.0.0.0')
      expect(request.body).not.toBeNull()
    })
  })

  describe('and the request body has already been consumed', () => {
    let nodeMessage: any

    beforeEach(async () => {
      nodeMessage = Object.assign(Readable.from([Buffer.from('payload')]), {
        method: 'POST',
        url: '/resource',
        headers: {}
      })
      // Simulate an upstream consumer (e.g. an Express body-parser) that drains
      // the incoming stream before the request is built.
      for await (const _chunk of nodeMessage) {
        // drain
      }
    })

    it('should not throw and should not attach a body', () => {
      let request!: ReturnType<typeof getRequestFromNodeMessage>
      expect(() => {
        request = getRequestFromNodeMessage(nodeMessage, '0.0.0.0')
      }).not.toThrow()
      expect(request.body).toBeNull()
    })
  })

  describe('and a maxBodySize is configured', () => {
    let nodeMessage: any

    describe('and the streamed body stays within the limit', () => {
      beforeEach(() => {
        nodeMessage = Object.assign(Readable.from([Buffer.from('payload')]), {
          method: 'POST',
          url: '/resource',
          headers: {}
        })
      })

      it('should resolve the body contents', async () => {
        const request = getRequestFromNodeMessage(nodeMessage, '0.0.0.0', 1024)
        await expect(request.text()).resolves.toEqual('payload')
      })
    })

    describe('and the streamed body exceeds the limit', () => {
      beforeEach(() => {
        nodeMessage = Object.assign(Readable.from([Buffer.from('x'.repeat(64))]), {
          method: 'POST',
          url: '/resource',
          headers: {}
        })
      })

      it('should reject when the body is read', async () => {
        const request = getRequestFromNodeMessage(nodeMessage, '0.0.0.0', 8)
        await expect(request.text()).rejects.toThrow()
      })
    })
  })
})

describe('when checking a declared content-length against a max body size', () => {
  describe('and the declared length is greater than the max', () => {
    it('should report it as exceeding', () => {
      expect(exceedsContentLength('100', 50)).toEqual(true)
    })
  })

  describe('and the declared length is equal to the max', () => {
    it('should not report it as exceeding', () => {
      expect(exceedsContentLength('50', 50)).toEqual(false)
    })
  })

  describe('and the header is missing or empty', () => {
    it('should treat undefined as not exceeding', () => {
      expect(exceedsContentLength(undefined, 50)).toEqual(false)
    })

    it('should treat null as not exceeding', () => {
      expect(exceedsContentLength(null, 50)).toEqual(false)
    })

    it('should treat an empty string as not exceeding', () => {
      expect(exceedsContentLength('', 50)).toEqual(false)
    })
  })

  describe('and the header is not numeric', () => {
    it('should treat it as not exceeding so the streaming limiter can decide', () => {
      expect(exceedsContentLength('not-a-number', 50)).toEqual(false)
    })
  })
})

describe('when limiting a request body stream', () => {
  describe('and the body stays within the limit', () => {
    let source: Readable

    beforeEach(() => {
      source = Readable.from([Buffer.from('hello')])
    })

    it('should pass the body through unchanged', async () => {
      const limiter = createBodySizeLimiter(source, 1024)
      const chunks: Buffer[] = []
      for await (const chunk of limiter) {
        chunks.push(Buffer.from(chunk))
      }
      expect(Buffer.concat(chunks).toString()).toEqual('hello')
    })
  })

  describe('and the body exceeds the limit', () => {
    let source: Readable

    beforeEach(() => {
      source = Readable.from([Buffer.from('x'.repeat(64))])
    })

    it('should error with a 413 status once the limit is crossed', async () => {
      const limiter = createBodySizeLimiter(source, 8)
      const error: any = await new Promise((resolve) => {
        limiter.on('error', resolve)
        limiter.resume()
      })
      expect(error.status).toEqual(413)
    })
  })
})

describe('when creating the underlying node server', () => {
  const noop: RequestListener = () => {}

  describe('and tuning options are provided', () => {
    it('should apply every option to the node server', () => {
      const server = getServer(
        {
          keepAliveTimeout: 5000,
          headersTimeout: 6000,
          requestTimeout: 1000,
          maxHeadersCount: 50,
          maxRequestsPerSocket: 10
        },
        noop
      )
      expect(server.keepAliveTimeout).toEqual(5000)
      expect(server.headersTimeout).toEqual(6000)
      expect(server.requestTimeout).toEqual(1000)
      expect(server.maxHeadersCount).toEqual(50)
      expect(server.maxRequestsPerSocket).toEqual(10)
    })
  })

  describe('and no tuning options are provided', () => {
    it('should fall back to the default keep-alive and headers timeouts', () => {
      const server = getServer({}, noop)
      expect(server.keepAliveTimeout).toEqual(70_000)
      expect(server.headersTimeout).toEqual(75_000)
    })
  })

  describe('and https options are provided', () => {
    it('should create an https server rather than being overwritten by the http fallback', () => {
      const server = getServer({ https: {} }, noop)
      expect(server).toBeInstanceOf(https.Server)
    })
  })

  describe('and no transport options are provided', () => {
    it('should default to a plain http server', () => {
      const server = getServer({}, noop)
      expect(server).not.toBeInstanceOf(https.Server)
    })
  })
})
