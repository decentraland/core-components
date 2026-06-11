import { getRequestFromNodeMessage, normalizeResponseBody, NormalizedResponse } from '../src/logic'
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
})
