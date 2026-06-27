import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import type { Server } from 'http'
import * as net from 'net'
import { createServerComponent, getUnderlyingServer, Router } from '../src'
import { FullHttpServerComponent } from '../src/server'
import type { IHttpServerOptions } from '../src/types'
import { multipartParserWrapper } from './busboy'

type RunningServer = {
  server: FullHttpServerComponent<{}>
  baseUrl: string
  port: number
  stop: () => Promise<void>
}

// Splits a string into fixed-size pieces, so a body can be streamed in chunks small enough to trip
// the limiter mid-stream.
function chunkString(value: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < value.length; i += size) {
    chunks.push(value.slice(i, i + size))
  }
  return chunks
}

// Sends a chunked POST (no Content-Length) over a raw socket — global `fetch` always frames a
// string/Buffer body with a Content-Length, which would hit the up-front check instead of the
// streaming limiter. `extraHeaders` (CRLF-terminated) lets callers add e.g. a multipart
// Content-Type. Resolves with the raw HTTP response text once the status line arrives.
function sendChunkedBody(port: number, chunks: string[], extraHeaders = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`POST / HTTP/1.1\r\nHost: x\r\n${extraHeaders}Transfer-Encoding: chunked\r\n\r\n`)
      let i = 0
      const sendNext = () => {
        if (i >= chunks.length) {
          socket.write('0\r\n\r\n')
          return
        }
        const chunk = chunks[i++]
        socket.write(`${chunk.length.toString(16)}\r\n${chunk}\r\n`)
        setTimeout(sendNext, 20)
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

async function startServer(
  options: Partial<IHttpServerOptions>,
  logs?: Parameters<typeof createServerComponent>[0]['logs']
): Promise<RunningServer> {
  const resolvedLogs = logs ?? (await createLogComponent({}))
  // Port 0 binds an ephemeral port, so concurrent test files never clash.
  const config = createConfigComponent({ HTTP_SERVER_PORT: '0', HTTP_SERVER_HOST: '127.0.0.1' })

  const server = await createServerComponent<{}>({ logs: resolvedLogs, config }, options)
  // `start`/`stop` are optional on `IBaseComponent` and `start` is typed to take lifecycle options
  // the implementation ignores; call them directly here instead of going through a full runner.
  await (server.start as () => Promise<void>)()

  const underlying = await getUnderlyingServer<Server>(server)
  const address = underlying.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    stop: () => (server.stop as () => Promise<void>)()
  }
}

describe('when the http server is configured with a maxBodySize', () => {
  let running: RunningServer

  beforeEach(async () => {
    running = await startServer({ maxBodySize: 16 })
    running.server.resetMiddlewares()
    running.server.use(async (ctx) => ({ status: 200, body: await ctx.request.text() }))
  })

  afterEach(async () => {
    await running.stop()
  })

  describe('and the request body is within the limit', () => {
    let response: Response
    let body: string

    beforeEach(async () => {
      response = await fetch(`${running.baseUrl}/`, { method: 'POST', body: 'small body' })
      body = await response.text()
    })

    it('should respond with a 200', () => {
      expect(response.status).toEqual(200)
    })

    it('should echo the body back', () => {
      expect(body).toEqual('small body')
    })
  })

  describe('and the request declares a Content-Length over the limit', () => {
    let response: Response
    let body: string

    beforeEach(async () => {
      response = await fetch(`${running.baseUrl}/`, { method: 'POST', body: 'x'.repeat(64) })
      body = await response.text()
    })

    it('should respond with a 413', () => {
      expect(response.status).toEqual(413)
    })

    it('should respond with the Payload Too Large body', () => {
      expect(body).toEqual('Payload Too Large')
    })
  })

  describe('and a GET request without a body is made', () => {
    let response: Response

    beforeEach(async () => {
      response = await fetch(`${running.baseUrl}/`, { method: 'GET' })
    })

    it('should respond with a 200', () => {
      expect(response.status).toEqual(200)
    })
  })

  describe('and the body is streamed chunked (no Content-Length) over the limit', () => {
    let response: string

    beforeEach(async () => {
      // Five 10-byte chunks = 50 bytes, well over the 16-byte limit, with no Content-Length so the
      // up-front check cannot catch it — the streaming limiter must.
      response = await sendChunkedBody(running.port, ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(10), 'x'.repeat(10), 'x'.repeat(10)])
    })

    it('should respond with a 413 while streaming', () => {
      expect(response).toMatch(/HTTP\/1\.1 413/)
    })

    it('should respond with the Payload Too Large body', () => {
      expect(response).toMatch(/Payload Too Large/)
    })

    it('should close the connection so the client cannot keep streaming', () => {
      expect(response).toMatch(/connection: close/i)
    })
  })

})

describe('when the http server is configured with a wildcard CORS origin and a maxBodySize', () => {
  let running: RunningServer

  beforeEach(async () => {
    running = await startServer({ maxBodySize: 16, cors: { origin: '*' } })
    running.server.resetMiddlewares()
    running.server.use(async (ctx) => ({ status: 200, body: await ctx.request.text() }))
  })

  afterEach(async () => {
    await running.stop()
  })

  describe('and a cross-origin request exceeds the limit', () => {
    let res: Response

    beforeEach(async () => {
      res = await fetch(`${running.baseUrl}/`, {
        method: 'POST',
        body: 'x'.repeat(64),
        headers: { origin: 'https://example.com' }
      })
    })

    it('should respond with a 413', () => {
      expect(res.status).toEqual(413)
    })

    it('should still set CORS headers so the browser can read the rejection', () => {
      expect(res.headers.get('access-control-allow-origin')).toEqual('*')
    })
  })

  describe('and a request without an Origin header exceeds the limit', () => {
    let res: Response

    beforeEach(async () => {
      res = await fetch(`${running.baseUrl}/`, { method: 'POST', body: 'x'.repeat(64) })
    })

    it('should respond with a 413', () => {
      expect(res.status).toEqual(413)
    })

    it('should not add an access-control-allow-origin header when there is no origin to reflect', () => {
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })
  })
})

describe('when the http server is configured with a reflected CORS origin and a maxBodySize', () => {
  let running: RunningServer

  beforeEach(async () => {
    running = await startServer({ maxBodySize: 16, cors: { origin: ['https://example.com'] } })
    running.server.resetMiddlewares()
    running.server.use(async (ctx) => ({ status: 200, body: await ctx.request.text() }))
  })

  afterEach(async () => {
    await running.stop()
  })

  describe('and an allowed cross-origin request exceeds the limit', () => {
    let response: Response

    beforeEach(async () => {
      response = await fetch(`${running.baseUrl}/`, {
        method: 'POST',
        body: 'x'.repeat(64),
        headers: { origin: 'https://example.com' }
      })
    })

    it('should respond with a 413', () => {
      expect(response.status).toEqual(413)
    })

    it('should reflect the request origin on the access-control-allow-origin header', () => {
      expect(response.headers.get('access-control-allow-origin')).toEqual('https://example.com')
    })
  })
})

describe('when the http server has a maxBodySize and a multipart handler', () => {
  let running: RunningServer

  beforeEach(async () => {
    running = await startServer({ maxBodySize: 100 })
    running.server.resetMiddlewares()
    const routes = new Router()
    routes.post(
      '/',
      multipartParserWrapper(async (ctx) => ({ status: 200, body: { fields: Object.keys(ctx.formData.fields) } }))
    )
    running.server.use(routes.middleware())
  })

  afterEach(async () => {
    await running.stop()
  })

  describe('and an oversized multipart upload declares its Content-Length', () => {
    let response: Response

    beforeEach(async () => {
      const form = new FormData()
      form.append('file', 'x'.repeat(500))
      response = await fetch(`${running.baseUrl}/`, { method: 'POST', body: form as any })
    })

    it('should respond with a 413', () => {
      expect(response.status).toEqual(413)
    })
  })

  describe('and an oversized multipart body is streamed chunked without a Content-Length', () => {
    let response: string

    beforeEach(async () => {
      const boundary = '----maxbodysizetest'
      const payload =
        `--${boundary}\r\nContent-Disposition: form-data; name="f"; filename="a.bin"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n${'x'.repeat(500)}\r\n--${boundary}--\r\n`
      response = await sendChunkedBody(
        running.port,
        chunkString(payload, 40),
        `Content-Type: multipart/form-data; boundary=${boundary}\r\n`
      )
    })

    it('should respond with a 413 instead of surfacing an unhandled stream error', () => {
      expect(response).toMatch(/HTTP\/1\.1 413/)
    })
  })
})

describe('when an oversized request is rejected up-front by the Content-Length check', () => {
  let running: RunningServer
  let warn: jest.Mock

  beforeEach(async () => {
    warn = jest.fn()
    const logs = {
      getLogger: () => ({ log: jest.fn(), debug: jest.fn(), info: jest.fn(), warn, error: jest.fn() })
    } as any
    running = await startServer({ maxBodySize: 16 }, logs)
    running.server.resetMiddlewares()
    running.server.use(async () => ({ status: 200 }))
    await fetch(`${running.baseUrl}/`, { method: 'POST', body: 'x'.repeat(64) })
  })

  afterEach(async () => {
    await running.stop()
  })

  it('should log a warning naming the cause with the request method and configured limit', () => {
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('maxBodySize'),
      expect.objectContaining({ method: 'POST', maxBodySize: 16 })
    )
  })
})

describe('when creating the server with an invalid maxBodySize', () => {
  let logs: Awaited<ReturnType<typeof createLogComponent>>
  let config: ReturnType<typeof createConfigComponent>
  let maxBodySize: number
  let error: Error | undefined

  beforeEach(async () => {
    logs = await createLogComponent({})
    config = createConfigComponent({ HTTP_SERVER_PORT: '0', HTTP_SERVER_HOST: '127.0.0.1' })
    error = undefined
  })

  describe('and the value is zero', () => {
    beforeEach(async () => {
      maxBodySize = 0
      error = await createServerComponent<{}>({ logs, config }, { maxBodySize }).catch((e) => e)
    })

    it('should reject with an invalid maxBodySize error', () => {
      expect(error?.message).toContain('Invalid maxBodySize')
    })
  })

  describe('and the value is negative', () => {
    beforeEach(async () => {
      maxBodySize = -1
      error = await createServerComponent<{}>({ logs, config }, { maxBodySize }).catch((e) => e)
    })

    it('should reject with an invalid maxBodySize error', () => {
      expect(error?.message).toContain('Invalid maxBodySize')
    })
  })

  describe('and the value is fractional', () => {
    beforeEach(async () => {
      maxBodySize = 1.5
      error = await createServerComponent<{}>({ logs, config }, { maxBodySize }).catch((e) => e)
    })

    it('should reject with an invalid maxBodySize error', () => {
      expect(error?.message).toContain('Invalid maxBodySize')
    })
  })
})
