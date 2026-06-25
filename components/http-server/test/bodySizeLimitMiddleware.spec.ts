import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import type { Server } from 'http'
import * as net from 'net'
import { IHttpServerComponent } from '@dcl/core-commons'
import { createBodySizeLimitMiddleware, createServerComponent, getUnderlyingServer, Router } from '../src'

// Streams a chunked POST (no Content-Length) larger than the limit over a raw socket; the up-front
// header check can't catch it, so the streaming cap has to. Resolves with the raw HTTP response.
function sendChunkedOverLimit(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write('POST /notes HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n')
      let sent = 0
      const sendNext = () => {
        if (sent >= 200) {
          socket.write('0\r\n\r\n')
          return
        }
        sent += 10
        socket.write(`a\r\n${'x'.repeat(10)}\r\n`)
        setTimeout(sendNext, 8)
      }
      sendNext()
    })

    let data = ''
    socket.on('data', (buf) => {
      data += buf.toString()
      if (/HTTP\/1\.1 \d+/.test(data)) {
        socket.destroy()
        resolve(data)
      }
    })
    socket.on('error', reject)
    socket.setTimeout(5000, () => {
      socket.destroy()
      reject(new Error('timed out waiting for a response'))
    })
  })
}

// Builds a POST request whose body is a stream with no Content-Length, so the streaming cap (not the
// up-front header check) is what has to enforce the limit.
function makeStreamRequest(byteCount: number): Request {
  let sent = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= byteCount) {
        controller.close()
        return
      }
      const size = Math.min(16, byteCount - sent)
      sent += size
      controller.enqueue(new Uint8Array(size).fill(120))
    }
  })
  return new Request('http://localhost/resource', {
    method: 'POST',
    body: stream,
    duplex: 'half'
  } as RequestInit & { duplex: 'half' })
}

function createContext(request: Request): IHttpServerComponent.DefaultContext {
  return { request, url: new URL(request.url) }
}

describe('when creating the body-size-limit middleware with an invalid maxBodySize', () => {
  let error: Error | undefined

  beforeEach(() => {
    error = undefined
  })

  describe('and the value is zero', () => {
    beforeEach(() => {
      try {
        createBodySizeLimitMiddleware(0)
      } catch (e) {
        error = e as Error
      }
    })

    it('should throw an invalid maxBodySize error', () => {
      expect(error?.message).toContain('Invalid maxBodySize')
    })
  })

  describe('and the value is negative', () => {
    beforeEach(() => {
      try {
        createBodySizeLimitMiddleware(-1)
      } catch (e) {
        error = e as Error
      }
    })

    it('should throw an invalid maxBodySize error', () => {
      expect(error?.message).toContain('Invalid maxBodySize')
    })
  })

  describe('and the value is fractional', () => {
    beforeEach(() => {
      try {
        createBodySizeLimitMiddleware(1.5)
      } catch (e) {
        error = e as Error
      }
    })

    it('should throw an invalid maxBodySize error', () => {
      expect(error?.message).toContain('Invalid maxBodySize')
    })
  })
})

describe('when the body-size-limit middleware handles a request', () => {
  let middleware: IHttpServerComponent.IRequestHandler<{}>
  let next: jest.Mock

  beforeEach(() => {
    middleware = createBodySizeLimitMiddleware(100)
    next = jest.fn().mockResolvedValue({ status: 200 })
  })

  describe('and the request declares a Content-Length over the limit', () => {
    let context: IHttpServerComponent.DefaultContext
    let result: IHttpServerComponent.IResponse

    beforeEach(async () => {
      // A manually-constructed Request doesn't expose a computed `content-length`, so set it
      // explicitly to exercise the up-front header check (a real server receives it from the client).
      context = createContext(
        new Request('http://localhost/resource', {
          method: 'POST',
          headers: { 'content-length': '200' },
          body: 'x'.repeat(200)
        })
      )
      result = await middleware(context, next)
    })

    it('should respond with a 413 payload too large', () => {
      expect(result).toEqual({ status: 413, body: 'Payload Too Large' })
    })

    it('should not continue to the next handler', () => {
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('and the request declares a Content-Length within the limit', () => {
    let context: IHttpServerComponent.DefaultContext
    let body: string

    beforeEach(async () => {
      context = createContext(
        new Request('http://localhost/resource', {
          method: 'POST',
          headers: { 'content-length': '5' },
          body: 'small'
        })
      )
      await middleware(context, next)
      body = await context.request.text()
    })

    it('should continue to the next handler', () => {
      expect(next).toHaveBeenCalled()
    })

    it('should leave the body readable by downstream handlers', () => {
      expect(body).toEqual('small')
    })
  })

  describe('and a streamed body without a Content-Length stays within the limit', () => {
    let context: IHttpServerComponent.DefaultContext
    let body: string

    beforeEach(async () => {
      context = createContext(makeStreamRequest(50))
      await middleware(context, next)
      body = await context.request.text()
    })

    it('should continue to the next handler', () => {
      expect(next).toHaveBeenCalled()
    })

    it('should leave the body readable by downstream handlers', () => {
      expect(body).toEqual('x'.repeat(50))
    })
  })

  describe('and a streamed body without a Content-Length exceeds the limit', () => {
    let context: IHttpServerComponent.DefaultContext
    let error: any

    beforeEach(async () => {
      context = createContext(makeStreamRequest(500))
      await middleware(context, next)
      try {
        await context.request.text()
      } catch (e) {
        error = e
      }
    })

    it('should make the downstream body read reject with a 413', () => {
      expect(error?.status).toEqual(413)
    })
  })

  describe('and the request has no body', () => {
    let context: IHttpServerComponent.DefaultContext

    beforeEach(async () => {
      context = createContext(new Request('http://localhost/resource', { method: 'GET' }))
      await middleware(context, next)
    })

    it('should continue to the next handler', () => {
      expect(next).toHaveBeenCalled()
    })
  })
})

describe('when the body-size-limit middleware is mounted on a real server route', () => {
  let server: any
  let baseUrl: string
  let port: number

  beforeEach(async () => {
    const logs = await createLogComponent({})
    const config = createConfigComponent({ HTTP_SERVER_PORT: '0', HTTP_SERVER_HOST: '127.0.0.1' })
    // No server-wide cap: the route middleware is the only thing enforcing the limit here.
    server = await createServerComponent<{}>({ logs, config }, {})
    await server.start()
    server.resetMiddlewares()
    const routes = new Router()
    routes.post('/notes', createBodySizeLimitMiddleware(100), async (ctx: any) => ({
      status: 200,
      body: await ctx.request.text()
    }))
    server.use(routes.middleware())
    const underlying = await getUnderlyingServer<Server>(server)
    port = (underlying.address() as any).port
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await server.stop()
  })

  describe('and a request declares a Content-Length over the limit', () => {
    let response: Response

    beforeEach(async () => {
      response = await fetch(`${baseUrl}/notes`, { method: 'POST', body: 'x'.repeat(200) })
    })

    it('should respond with a 413', () => {
      expect(response.status).toEqual(413)
    })
  })

  describe('and the request body is within the limit', () => {
    let response: Response
    let body: string

    beforeEach(async () => {
      response = await fetch(`${baseUrl}/notes`, { method: 'POST', body: 'small' })
      body = await response.text()
    })

    it('should respond with a 200', () => {
      expect(response.status).toEqual(200)
    })

    it('should hand the body to the downstream handler', () => {
      expect(body).toEqual('small')
    })
  })

  describe('and a chunked body without a Content-Length exceeds the limit', () => {
    let rawResponse: string

    beforeEach(async () => {
      rawResponse = await sendChunkedOverLimit(port)
    })

    it('should respond with a 413 once the streaming limit is crossed', () => {
      expect(rawResponse).toMatch(/HTTP\/1\.1 413/)
    })
  })
})
