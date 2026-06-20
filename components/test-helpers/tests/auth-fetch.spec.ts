import * as http from 'http'
import { IConfigComponent } from '@well-known-components/interfaces'
import { AUTH_CHAIN_HEADER_PREFIX, AUTH_METADATA_HEADER, AUTH_TIMESTAMP_HEADER } from '@dcl/crypto-middleware'
import { createLocalFetchComponent, defaultServerConfig, getIdentity } from '../src'
import type { Identity } from '../src'

function createConfig(values: Record<string, string>): IConfigComponent {
  return {
    getString: async (key: string) => values[key],
    getNumber: async (key: string) => Number(values[key]),
    requireString: async (key: string) => values[key],
    requireNumber: async (key: string) => Number(values[key])
  } as IConfigComponent
}

describe('when creating a local fetch component with authentication', () => {
  let server: http.Server
  let config: IConfigComponent
  let identity: Identity
  const host = '127.0.0.1'
  const route = '/protected'

  beforeEach(async () => {
    identity = await getIdentity()
    const port = defaultServerConfig().HTTP_SERVER_PORT
    config = createConfig({ HTTP_SERVER_HOST: host, HTTP_SERVER_PORT: port })

    server = http.createServer((_req, res) => {
      res.setHeader('Connection', 'close')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      // Echo the received request headers so the test can assert on them.
      res.end(JSON.stringify({ headers: _req.headers }))
    })

    await new Promise<void>((resolve) => server.listen(Number(port), host, resolve))
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  })

  describe('and the request is sent without an identity', () => {
    it('should not attach any signed-fetch headers', async () => {
      const localFetch = await createLocalFetchComponent(config)

      const { headers } = await (await localFetch.fetch(route)).json()

      expect(headers[`${AUTH_CHAIN_HEADER_PREFIX}0`]).toBeUndefined()
      expect(headers[AUTH_TIMESTAMP_HEADER]).toBeUndefined()
      expect(headers[AUTH_METADATA_HEADER]).toBeUndefined()
    })
  })

  describe('and the request is sent with an identity', () => {
    it('should attach the signed auth-chain, timestamp and metadata headers', async () => {
      const localFetch = await createLocalFetchComponent(config)

      const { headers } = await (await localFetch.fetch(route, { identity })).json()

      expect(headers[`${AUTH_CHAIN_HEADER_PREFIX}0`]).toBeDefined()
      expect(headers[AUTH_TIMESTAMP_HEADER]).toBeDefined()
      expect(headers[AUTH_METADATA_HEADER]).toBe('{}')
    })

    it('should include the provided metadata in the signed metadata header', async () => {
      const localFetch = await createLocalFetchComponent(config)
      const metadata = { intent: 'dcl:test' }

      const { headers } = await (await localFetch.fetch(route, { identity, metadata })).json()

      expect(headers[AUTH_METADATA_HEADER]).toBe(JSON.stringify(metadata))
    })

    it('should preserve caller-provided headers alongside the auth headers', async () => {
      const localFetch = await createLocalFetchComponent(config)

      const { headers } = await (await localFetch.fetch(route, { identity, headers: { 'x-custom': 'value' } })).json()

      expect(headers['x-custom']).toBe('value')
      expect(headers[`${AUTH_CHAIN_HEADER_PREFIX}0`]).toBeDefined()
    })
  })
})
