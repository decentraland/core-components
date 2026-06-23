import { IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import {
  IFetchComponent,
  createConfigMockedComponent,
  createFetchMockedComponent,
  createLoggerMockedComponent
} from '@dcl/core-commons'
import { setTimeout } from 'timers/promises'
import { createSubgraphComponent, ISubgraphComponent, SubgraphResponse, Variables } from '../src'
import { SubgraphQueryTimeoutError } from '../src/errors'
import { metricDeclarations } from '../src/metrics'
import { UNKNOWN_SUBGRAPH_PROVIDER } from '../src/utils'

jest.mock('timers/promises')

type FetchResponse = Awaited<ReturnType<IFetchComponent['fetch']>>

const SUBGRAPH_URL = 'https://mock-subgraph.url.com'

function createMetricsMockedComponent(): jest.Mocked<IMetricsComponent<keyof typeof metricDeclarations>> {
  return {
    startTimer: jest.fn().mockReturnValue({ end: jest.fn() }),
    increment: jest.fn(),
    decrement: jest.fn(),
    observe: jest.fn(),
    reset: jest.fn(),
    resetAll: jest.fn(),
    getValue: jest.fn()
  } as unknown as jest.Mocked<IMetricsComponent<keyof typeof metricDeclarations>>
}

let setTimeoutMock: jest.Mock
let fetchMock: jest.Mock
let warnLogMock: jest.Mock
let logs: ILoggerComponent
let config: IConfigComponent
let metrics: jest.Mocked<IMetricsComponent<keyof typeof metricDeclarations>>
let fetch: IFetchComponent
let subgraph: ISubgraphComponent

beforeEach(async () => {
  setTimeoutMock = setTimeout as unknown as jest.Mock
  // By default keep the `withTimeout` timer pending (it should never fire) and resolve any
  // other timer (e.g. the retry backoff) immediately so tests don't wait on real time.
  setTimeoutMock.mockImplementation((_time: number, name?: string) =>
    name === 'Timeout' ? new Promise<void>(() => {}) : Promise.resolve()
  )

  fetchMock = jest.fn()
  warnLogMock = jest.fn()
  fetch = createFetchMockedComponent({ fetch: fetchMock })
  logs = createLoggerMockedComponent({ warn: warnLogMock })
  config = createConfigMockedComponent()
  metrics = createMetricsMockedComponent()

  subgraph = await createSubgraphComponent({ logs, config, metrics, fetch }, SUBGRAPH_URL)
})

afterEach(() => {
  jest.resetAllMocks()
})

describe('when querying a subgraph', () => {
  const query = 'query ThisIsAQuery() {}'
  let variables: Variables

  beforeEach(() => {
    variables = { some: 'very interesting', variables: ['we have', 'here'] }
  })

  describe('and the request is ok', () => {
    let response: FetchResponse
    let okResponseData: { data: Record<string, unknown> }

    beforeEach(() => {
      okResponseData = { data: { elements: [1, 3, 4], someOther: 'data' } }
      response = {
        ok: true,
        status: 200,
        json: async () => okResponseData,
        headers: new Map()
      } as unknown as FetchResponse
      fetchMock.mockResolvedValue(response)
    })

    it("should resolve with the response's data property", async () => {
      const result = await subgraph.query('query')
      expect(result).toEqual(okResponseData.data)
    })

    it('should increment the subgraph_ok_total metric for the url', async () => {
      await subgraph.query('query')
      expect(metrics.increment).toHaveBeenCalledWith('subgraph_ok_total', { url: SUBGRAPH_URL })
    })

    it('should forward the query and variables to the subgraph via the fetch component', async () => {
      await subgraph.query(query, variables)
      expect(fetchMock).toHaveBeenCalledWith(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-agent': 'Subgraph component / Unknown sender' },
        body: JSON.stringify({ query, variables }),
        abortController: expect.any(AbortController)
      })
    })

    describe('and the agent name is configured', () => {
      beforeEach(async () => {
        ;(config.getString as jest.Mock).mockImplementation(async (name: string) =>
          name === 'SUBGRAPH_COMPONENT_AGENT_NAME' ? 'An agent' : ''
        )
        subgraph = await createSubgraphComponent({ logs, config, metrics, fetch }, SUBGRAPH_URL)
      })

      it('should send the configured agent name in the User-agent header', async () => {
        await subgraph.query(query, variables)
        expect(fetchMock).toHaveBeenCalledWith(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-agent': 'Subgraph component / An agent' },
          body: JSON.stringify({ query, variables }),
          abortController: expect.any(AbortController)
        })
      })
    })

    describe('and the agent name is not configured', () => {
      it('should send the default agent name in the User-agent header', async () => {
        await subgraph.query(query, variables)
        expect(fetchMock).toHaveBeenCalledWith(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-agent': 'Subgraph component / Unknown sender' },
          body: JSON.stringify({ query, variables }),
          abortController: expect.any(AbortController)
        })
      })
    })

    describe('and a remainingAttempts greater than the configured retries is supplied', () => {
      it('should start the first attempt with the base timeout rather than a negative one', async () => {
        await subgraph.query(query, variables, 10)
        expect(setTimeoutMock).toHaveBeenCalledWith(10000, 'Timeout', expect.anything())
      })
    })
  })

  describe('and the server responds with an internal error', () => {
    let response: FetchResponse

    beforeEach(() => {
      response = { ok: false, status: 500, headers: new Map() } as unknown as FetchResponse
      fetchMock.mockResolvedValue(response)
    })

    it('should reject with an invalid request error mentioning the status and unknown provider', async () => {
      await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
        `Invalid request. Status: 500. Provider: ${UNKNOWN_SUBGRAPH_PROVIDER}`
      )
    })

    it('should increment the subgraph_errors_total metric with an unknown kind', async () => {
      await expect(subgraph.query('query', {}, 0)).rejects.toThrow()
      expect(metrics.increment).toHaveBeenCalledWith('subgraph_errors_total', { url: SUBGRAPH_URL, kind: 'unknown' })
    })

    it('should log a warning with the error', async () => {
      await expect(subgraph.query('query', {}, 0)).rejects.toThrow()
      expect(warnLogMock).toHaveBeenCalled()
    })

    it('should serialize the request body only once across all retry attempts', async () => {
      const stringifySpy = jest.spyOn(JSON, 'stringify')

      await expect(subgraph.query(query, variables, 2)).rejects.toThrow()

      const bodyStringifyCalls = stringifySpy.mock.calls.filter(
        ([value]) => !!value && typeof value === 'object' && 'query' in value && 'variables' in value
      )
      expect(bodyStringifyCalls).toHaveLength(1)
      stringifySpy.mockRestore()
    })

    describe('and the response carries a subgraph provider header', () => {
      beforeEach(() => {
        ;(response.headers as unknown as Map<string, string>).set('X-Subgraph-Provider', 'SubgraphProvider')
      })

      it('should include the subgraph provider in the error message', async () => {
        await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
          'Invalid request. Status: 500. Provider: SubgraphProvider'
        )
      })
    })

    describe('and the response body can be cancelled', () => {
      let cancelMock: jest.Mock

      beforeEach(() => {
        cancelMock = jest.fn().mockResolvedValue(undefined)
        ;(response as unknown as { body: { cancel: jest.Mock } }).body = { cancel: cancelMock }
      })

      it('should cancel the response body on every failed attempt so the connection is not leaked', async () => {
        await expect(subgraph.query('query', {}, 2)).rejects.toThrow()

        expect(cancelMock).toHaveBeenCalledTimes(3)
      })
    })
  })

  describe('and the response contains GraphQL errors', () => {
    let errorResponseData: SubgraphResponse<unknown>
    let response: FetchResponse

    beforeEach(() => {
      errorResponseData = {
        data: undefined as unknown as Record<string, unknown>,
        errors: { message: 'No suitable indexer found for subgraph deployment' }
      }
      response = {
        ok: true,
        status: 400,
        json: async () => errorResponseData,
        headers: new Map()
      } as unknown as FetchResponse
      fetchMock.mockResolvedValue(response)
    })

    it('should increment the subgraph_errors_total metric with an unknown kind', async () => {
      await expect(subgraph.query('query', {}, 0)).rejects.toThrow()
      expect(metrics.increment).toHaveBeenCalledWith('subgraph_errors_total', { url: SUBGRAPH_URL, kind: 'unknown' })
    })

    describe('and the errors property is empty but the data is invalid', () => {
      beforeEach(() => {
        errorResponseData = { data: {} as Record<string, unknown>, errors: undefined }
      })

      it('should reject with an invalid response error for the unknown provider', async () => {
        await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
          `GraphQL Error: Invalid response. Provider: ${UNKNOWN_SUBGRAPH_PROVIDER}`
        )
      })

      describe('and the response carries a subgraph provider header', () => {
        beforeEach(() => {
          ;(response.headers as unknown as Map<string, string>).set('X-Subgraph-Provider', 'SubgraphProvider')
        })

        it('should include the subgraph provider in the error message', async () => {
          await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
            'GraphQL Error: Invalid response. Provider: SubgraphProvider'
          )
        })
      })
    })

    describe('and there are multiple GraphQL errors', () => {
      beforeEach(() => {
        errorResponseData = {
          data: undefined as unknown as Record<string, unknown>,
          errors: [{ message: 'some error' }, { message: 'happened' }]
        }
      })

      it('should reject with all the error messages joined', async () => {
        await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
          `GraphQL Error: Invalid response. Errors:\n- some error\n- happened. Provider: ${UNKNOWN_SUBGRAPH_PROVIDER}`
        )
      })

      describe('and the response carries a subgraph provider header', () => {
        beforeEach(() => {
          ;(response.headers as unknown as Map<string, string>).set('X-Subgraph-Provider', 'SubgraphProvider')
        })

        it('should include the subgraph provider in the error message', async () => {
          await expect(subgraph.query('query', {}, 0)).rejects.toThrow(
            'GraphQL Error: Invalid response. Errors:\n- some error\n- happened. Provider: SubgraphProvider'
          )
        })
      })
    })

    describe('and a number of retries is supplied', () => {
      const retries = 2

      it('should query the subgraph the supplied number of times plus the first attempt', async () => {
        await expect(subgraph.query('query', {}, retries)).rejects.toThrow()
        expect(fetchMock).toHaveBeenCalledTimes(retries + 1)
      })

      it('should increment the error metric on every attempt', async () => {
        await expect(subgraph.query('query', {}, retries)).rejects.toThrow()
        expect(metrics.increment).toHaveBeenCalledTimes(retries + 1)
      })
    })

    describe('and no number of retries is supplied', () => {
      const configuredRetries = 4

      beforeEach(async () => {
        ;(config.getNumber as jest.Mock).mockImplementation(async (name: string) => {
          switch (name) {
            case 'SUBGRAPH_COMPONENT_QUERY_TIMEOUT':
              return 500
            case 'SUBGRAPH_COMPONENT_TIMEOUT_INCREMENT':
              return 1
            case 'SUBGRAPH_COMPONENT_RETRIES':
              return configuredRetries
            default:
              return 0
          }
        })
        subgraph = await createSubgraphComponent({ logs, config, metrics, fetch }, SUBGRAPH_URL)
      })

      it('should query the subgraph the configured number of times plus the first attempt', async () => {
        await expect(subgraph.query('query')).rejects.toThrow()
        expect(fetchMock).toHaveBeenCalledTimes(configuredRetries + 1)
      })
    })
  })

  describe.each([
    ['and the query is syntactically incorrect', 'Unexpected `{[Punctuator]`\\nExpected `', 'syntax_error'],
    ['and the query is made over an invalid block', 'Failed to decode `block.number`', 'invalid_block']
  ])('%s', (_name: string, errorMessage: string, expectedKind: string) => {
    beforeEach(() => {
      const errorResponseData: SubgraphResponse<unknown> = {
        data: undefined as unknown as Record<string, unknown>,
        errors: [{ message: errorMessage }]
      }
      const response = {
        ok: true,
        status: 200,
        json: async () => errorResponseData,
        headers: new Map()
      } as unknown as FetchResponse
      fetchMock.mockResolvedValue(response)
    })

    it(`should increment the subgraph_errors_total metric with the "${expectedKind}" kind`, async () => {
      await expect(subgraph.query('query', {}, 0)).rejects.toThrow()
      expect(metrics.increment).toHaveBeenCalledWith('subgraph_errors_total', { url: SUBGRAPH_URL, kind: expectedKind })
    })

    it('should not retry the query even when retries are available', async () => {
      await expect(subgraph.query('query', {}, 5)).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the query times out', () => {
    beforeEach(() => {
      // Simulate a fetch component like `@dcl/fetch-component`, which rejects an aborted request
      // with a generic Error (not a native AbortError) once its abort controller fires.
      fetchMock.mockImplementation(
        (_url: string, options: { abortController: AbortController }) =>
          new Promise((_resolve, reject) => {
            options.abortController.signal.addEventListener('abort', () => {
              reject(new Error('Request aborted (timed out)'))
            })
          })
      )
      // Fire the `withTimeout` timer immediately so the request is aborted; any other timer resolves.
      setTimeoutMock.mockImplementation(() => Promise.resolve())
    })

    it('should reject with a SubgraphQueryTimeoutError', async () => {
      await expect(subgraph.query('query', {}, 0)).rejects.toBeInstanceOf(SubgraphQueryTimeoutError)
    })

    it('should increment the subgraph_errors_total metric with a timeout kind', async () => {
      await expect(subgraph.query('query', {}, 0)).rejects.toThrow()
      expect(metrics.increment).toHaveBeenCalledWith('subgraph_errors_total', { url: SUBGRAPH_URL, kind: 'timeout' })
    })
  })
})
