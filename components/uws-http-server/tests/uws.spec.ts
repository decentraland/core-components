import { createUWsComponent } from '../src'
import { createLogComponent } from '@well-known-components/logger'
import { createConfigComponent } from '@well-known-components/env-config-provider'

// uWebSockets.js reports a failed bind by calling the listen callback with a
// falsy socket (it does not throw). The native module is mocked here to exercise
// that path deterministically, without depending on a real unbindable address.
jest.mock('uWebSockets.js', () => ({
  App: jest.fn(() => ({
    listen: (_host: string, _port: number, cb: (token: unknown) => void) => cb(false)
  })),
  us_listen_socket_close: jest.fn()
}))

describe('when starting the server and the socket cannot be bound', () => {
  it('should reject start with a descriptive error', async () => {
    const logs = await createLogComponent({})
    const config = createConfigComponent({
      HTTP_SERVER_HOST: '0.0.0.0',
      HTTP_SERVER_PORT: '7273'
    })

    const server = await createUWsComponent({ logs, config })

    await expect(server.start()).rejects.toThrow('Failed to listen on 0.0.0.0:7273')
  })

  it('should allow a subsequent start attempt after a failed bind', async () => {
    const logs = await createLogComponent({})
    const config = createConfigComponent({
      HTTP_SERVER_HOST: '0.0.0.0',
      HTTP_SERVER_PORT: '7273'
    })

    const server = await createUWsComponent({ logs, config })

    await expect(server.start()).rejects.toThrow('Failed to listen on 0.0.0.0:7273')
    // The failed attempt is cleared, so a retry reaches the listen path again
    // (rather than the "start() called more than once" short-circuit).
    await expect(server.start()).rejects.toThrow('Failed to listen on 0.0.0.0:7273')
  })
})
