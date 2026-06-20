import * as http from 'http'
import { IConfigComponent } from '@well-known-components/interfaces'
import { createLocalFetchComponent, defaultServerConfig } from '../src'

function createConfig(values: Record<string, string>): IConfigComponent {
  return {
    getString: async (key: string) => values[key],
    getNumber: async (key: string) => Number(values[key]),
    requireString: async (key: string) => values[key],
    requireNumber: async (key: string) => Number(values[key])
  } as IConfigComponent
}

describe('when using the default server config', () => {
  it('should return a host and an auto-incrementing port', () => {
    const first = defaultServerConfig()
    const second = defaultServerConfig()

    expect(first.HTTP_SERVER_HOST).toBe('0.0.0.0')
    expect(Number(second.HTTP_SERVER_PORT)).toBe(Number(first.HTTP_SERVER_PORT) + 1)
  })
})

describe('when creating a local fetch component', () => {
  let server: http.Server
  let config: IConfigComponent
  const host = '127.0.0.1'
  const route = '/some-route'
  const responseBody = { someProp: true }

  beforeEach(async () => {
    const port = defaultServerConfig().HTTP_SERVER_PORT
    config = createConfig({ HTTP_SERVER_HOST: host, HTTP_SERVER_PORT: port })

    server = http.createServer((req, res) => {
      // Close the socket after each response so no keep-alive handle keeps the
      // process alive once the server is closed.
      res.setHeader('Connection', 'close')
      if (req.url === route) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(responseBody))
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    await new Promise<void>((resolve) => server.listen(Number(port), host, resolve))
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  })

  describe('and fetching a local path', () => {
    it('should resolve the response from the local server', async () => {
      const localFetch = await createLocalFetchComponent(config)

      const response = await localFetch.fetch(route)

      expect(await response.json()).toEqual(responseBody)
    })
  })

  describe('and fetching an absolute external URL', () => {
    it('should throw because only local testing URLs are allowed', async () => {
      const localFetch = await createLocalFetchComponent(config)

      await expect(localFetch.fetch('https://example.com')).rejects.toThrow(
        'localFetch only works for local testing-URLs'
      )
    })
  })
})
