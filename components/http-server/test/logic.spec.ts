import { getRequestFromNodeMessage, normalizeResponseBody, NormalizedResponse, success } from '../src/logic'
import type { ServerResponse } from 'http'
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
})
