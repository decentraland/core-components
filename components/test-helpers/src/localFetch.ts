import { IConfigComponent } from '@well-known-components/interfaces'
import { IFetchComponent, RequestOptions } from '@dcl/core-commons'

// Starting TCP port for test listeners. Seed it from the jest worker id so suites
// running in parallel workers don't collide on the same port.
/* istanbul ignore next */
let lastUsedPort = 19000 + parseInt(process.env.JEST_WORKER_ID || '1', 10) * 1000

function getPort() {
  lastUsedPort += 1
  return lastUsedPort
}

/**
 * Default server config (host + an auto-incrementing port) for tests that spin
 * up a real HTTP server.
 * @public
 */
export const defaultServerConfig = () => ({
  HTTP_SERVER_HOST: '0.0.0.0',
  HTTP_SERVER_PORT: String(getPort())
})

/**
 * Creates a fetch component that only resolves local testing URLs (paths
 * starting with `/`), targeting the host/port resolved from the config. Backed
 * by the native global `fetch`.
 * @public
 */
export async function createLocalFetchComponent(config: IConfigComponent): Promise<IFetchComponent> {
  const baseUrl = `http://${await config.requireString('HTTP_SERVER_HOST')}:${await config.requireNumber(
    'HTTP_SERVER_PORT'
  )}`

  return {
    async fetch(url: string | URL | Request, init?: RequestOptions): Promise<Response> {
      if (typeof url === 'string' && url.startsWith('/')) {
        return fetch(baseUrl + url, init)
      }
      throw new Error('localFetch only works for local testing-URLs')
    }
  }
}
