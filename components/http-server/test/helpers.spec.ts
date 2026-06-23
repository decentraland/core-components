import { Readable } from 'stream'
import { fromNativeResponse } from '../src/helpers'

describe('when adapting a native Response with fromNativeResponse', () => {
  describe('and the Response has a body', () => {
    let adapted: ReturnType<typeof fromNativeResponse>

    beforeEach(() => {
      adapted = fromNativeResponse(
        new Response('hello body', { status: 201, statusText: 'Created', headers: { 'x-test': 'yes' } })
      )
    })

    it('should carry over the status', () => {
      expect(adapted.status).toBe(201)
    })

    it('should carry over the status text', () => {
      expect(adapted.statusText).toBe('Created')
    })

    it('should carry over the headers', () => {
      expect((adapted.headers as Headers).get('x-test')).toBe('yes')
    })

    it('should expose the body as a Node Readable', () => {
      expect(adapted.body).toBeInstanceOf(Readable)
    })

    it('should preserve the body contents', async () => {
      const chunks: Buffer[] = []
      for await (const chunk of adapted.body as Readable) {
        chunks.push(Buffer.from(chunk))
      }
      expect(Buffer.concat(chunks).toString()).toBe('hello body')
    })
  })

  describe('and the Response has no body', () => {
    let adapted: ReturnType<typeof fromNativeResponse>

    beforeEach(() => {
      adapted = fromNativeResponse(new Response(null, { status: 204 }))
    })

    it('should leave the body undefined', () => {
      expect(adapted.body).toBeUndefined()
    })
  })

  describe('and the Response body has already been consumed', () => {
    let adapted: ReturnType<typeof fromNativeResponse>

    beforeEach(async () => {
      const response = new Response('already read', { status: 200 })
      await response.text()
      adapted = fromNativeResponse(response)
    })

    it('should not attach a body', () => {
      expect(adapted.body).toBeUndefined()
    })
  })

  describe('and the Response carries content framing/encoding headers', () => {
    let adapted: ReturnType<typeof fromNativeResponse>

    beforeEach(() => {
      adapted = fromNativeResponse(
        new Response('decoded body', {
          status: 200,
          headers: { 'content-encoding': 'gzip', 'content-length': '999', 'content-type': 'text/plain' }
        })
      )
    })

    it('should drop content-encoding because the body is already decoded', () => {
      expect((adapted.headers as Headers).has('content-encoding')).toBe(false)
    })

    it('should drop content-length because the body is re-streamed', () => {
      expect((adapted.headers as Headers).has('content-length')).toBe(false)
    })

    it('should preserve unrelated headers', () => {
      expect((adapted.headers as Headers).get('content-type')).toBe('text/plain')
    })
  })

  describe('and the Response body is locked by a reader', () => {
    let adapted: ReturnType<typeof fromNativeResponse>

    beforeEach(() => {
      const response = new Response('locked', { status: 200 })
      // Acquire a reader without consuming, leaving the stream locked but not used.
      response.body!.getReader()
      adapted = fromNativeResponse(response)
    })

    it('should forward without a body instead of throwing', () => {
      expect(adapted.body).toBeUndefined()
    })
  })
})
