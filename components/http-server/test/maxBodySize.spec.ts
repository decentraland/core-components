import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import type { Server } from 'http'
import { createServerComponent, getUnderlyingServer } from '../src'
import { FullHttpServerComponent } from '../src/server'
import type { IHttpServerOptions } from '../src/types'

type RunningServer = {
  server: FullHttpServerComponent<{}>
  baseUrl: string
  stop: () => Promise<void>
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
})
