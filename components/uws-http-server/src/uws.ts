import * as uws from 'uWebSockets.js'
import { Components, IUWsComponent } from './types'

export async function createUWsComponent(
  components: Pick<Components, 'config' | 'logs'>,
  options?: uws.AppOptions
): Promise<IUWsComponent> {
  const { config, logs } = components
  const [port, host] = await Promise.all([
    config.requireNumber('HTTP_SERVER_PORT'),
    await config.requireString('HTTP_SERVER_HOST')
  ])

  const logger = logs.getLogger('http-server')

  const app = uws.App(options || {})

  let listen: Promise<uws.us_listen_socket> | undefined
  async function start() {
    if (listen) {
      logger.error('start() called more than once')
      await listen
      return
    }
    listen = new Promise<uws.us_listen_socket>((resolve, reject) => {
      try {
        app.listen(host, port, (token) => {
          logger.log(`Listening ${host}:${port}`)
          resolve(token)
        })
      } catch (err: any) {
        reject(err)
      }
    })
    await listen
  }

  async function stop() {
    if (listen) {
      logger.info(`Closing server`)
      const token = await listen
      uws.us_listen_socket_close(token)
      logger.info(`Server closed`)
    }
  }

  return {
    app,
    start,
    stop
  }
}
