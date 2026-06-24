import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import type { Server } from 'http'
import * as net from 'net'
import { createServerComponent, getUnderlyingServer } from '../src'
import { FullHttpServerComponent } from '../src/server'
import type { IHttpServerOptions } from '../src/types'

type RunningServer = {
  server: FullHttpServerComponent<{}>
  baseUrl: string
  port: number
  stop: () => Promise<void>
}

// Sends a chunked POST (no Content-Length) over a raw socket — global `fetch` always frames a
// string/Buffer body with a Content-Length, which would hit the up-front check instead of the
// streaming limiter. Resolves with the raw HTTP response text once the status line arrives.
function sendChunkedBody(port: number, chunks: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write('POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n')
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

async function startServer(options: Partial<IHttpServerOptions>): Promise<RunningServer> {
  const logs = await createLogComponent({})
  // Port 0 binds an ephemeral port, so concurrent test files never clash.
  const config = createConfigComponent({ HTTP_SERVER_PORT: '0', HTTP_SERVER_HOST: '127.0.0.1' })

  const server = await createServerComponent<{}>({ logs, config }, options)
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
    it('should respond with a 200 and echo the body back', async () => {
      const res = await fetch(`${running.baseUrl}/`, { method: 'POST', body: 'small body' })
      expect(res.status).toEqual(200)
      expect(await res.text()).toEqual('small body')
    })
  })

  describe('and the request declares a Content-Length over the limit', () => {
    let res: Response

    beforeEach(async () => {
      res = await fetch(`${running.baseUrl}/`, { method: 'POST', body: 'x'.repeat(64) })
    })

    it('should respond with a 413', () => {
      expect(res.status).toEqual(413)
    })

    it('should respond with the Payload Too Large body', async () => {
      expect(await res.text()).toEqual('Payload Too Large')
    })
  })

  describe('and a GET request without a body is made', () => {
    it('should respond with a 200', async () => {
      const res = await fetch(`${running.baseUrl}/`, { method: 'GET' })
      expect(res.status).toEqual(200)
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
    it('should reflect the request origin on the 413 response', async () => {
      const res = await fetch(`${running.baseUrl}/`, {
        method: 'POST',
        body: 'x'.repeat(64),
        headers: { origin: 'https://example.com' }
      })
      expect(res.status).toEqual(413)
      expect(res.headers.get('access-control-allow-origin')).toEqual('https://example.com')
    })
  })
})

describe('when creating the server with an invalid maxBodySize', () => {
  let logs: Awaited<ReturnType<typeof createLogComponent>>
  let config: ReturnType<typeof createConfigComponent>

  beforeEach(async () => {
    logs = await createLogComponent({})
    config = createConfigComponent({ HTTP_SERVER_PORT: '0', HTTP_SERVER_HOST: '127.0.0.1' })
  })

  describe('and the value is zero', () => {
    it('should reject with an invalid maxBodySize error', async () => {
      await expect(createServerComponent<{}>({ logs, config }, { maxBodySize: 0 })).rejects.toThrow('Invalid maxBodySize')
    })
  })

  describe('and the value is negative', () => {
    it('should reject with an invalid maxBodySize error', async () => {
      await expect(createServerComponent<{}>({ logs, config }, { maxBodySize: -1 })).rejects.toThrow('Invalid maxBodySize')
    })
  })

  describe('and the value is fractional', () => {
    it('should reject with an invalid maxBodySize error', async () => {
      await expect(createServerComponent<{}>({ logs, config }, { maxBodySize: 1.5 })).rejects.toThrow('Invalid maxBodySize')
    })
  })
})
