import { createUWsComponent } from '../src'
import { createLogComponent } from '@well-known-components/logger'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLocalFetchCompoment } from '@well-known-components/test-helpers'
import * as uws from 'uWebSockets.js'

describe('integration test', () => {
  it('should start, receive the request and finally stop the server', async () => {
    const logs = await createLogComponent({})
    const config = createConfigComponent({
      HTTP_SERVER_HOST: '0.0.0.0',
      HTTP_SERVER_PORT: '7272'
    })

    const server = await createUWsComponent({ logs, config })
    server.app.get('/test', (res: uws.HttpResponse, _req: uws.HttpRequest) => {
      res.writeStatus('200 OK')
      res.end('ok')
    })
    await server.start()

    const fetch = await createLocalFetchCompoment(config)
    const res = await fetch.fetch('/test')

    expect(await res.text()).toEqual('ok')

    await server.stop()
  })
})
