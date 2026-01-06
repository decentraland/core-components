import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, instrumentHttpServerWithPromClientRegistry } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createRunner } from '@well-known-components/test-helpers'
import nodeFetch from 'node-fetch'
import { createMetricsComponent } from '../../src'
import { metricDeclarations } from './defaultMetrics'
import { mockedRouter } from './mockedServer'
import { TestComponents } from './test-helpers'
import { IFetchComponent } from '@well-known-components/interfaces'

let currentPort = 19000

// creates a "jest-like" describe function to run tests using the test components
export const describeE2E = createRunner({
  async main({ components, startComponents }) {
    components.server.use(mockedRouter())
    components.server.setContext({ components })
    await startComponents()
  },
  initComponents
})

async function initComponents(): Promise<TestComponents> {
  const config = createConfigComponent(
    {
      HTTP_SERVER_PORT: (currentPort + 1).toString(),
      HTTP_SERVER_HOST: '0.0.0.0'
    },
    process.env
  )

  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })

  const protocolHostAndProtocol = `http://${await config.requireString(
    'HTTP_SERVER_HOST'
  )}:${await config.requireNumber('HTTP_SERVER_PORT')}`

  const server = await createServerComponent<any>({ logs, config }, {})

  const fetch: IFetchComponent = {
    async fetch(url, initRequest?) {
      return nodeFetch(protocolHostAndProtocol + url, initRequest ? initRequest : {})
    }
  }

  await instrumentHttpServerWithPromClientRegistry({ metrics, server, config, registry: metrics.registry! })

  return { logs, config, server, fetch, metrics }
}
