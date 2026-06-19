import { IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { IFetchComponent } from '@dcl/core-commons'
import { randomUUID } from 'crypto'
import { setTimeout } from 'timers/promises'
import { ISubgraphComponent, PostQueryResponse, SubgraphResponse, Variables } from './types'
import { metricDeclarations } from './metrics'
import { SubgraphQueryTimeoutError } from './errors'
import { UNKNOWN_SUBGRAPH_PROVIDER, withTimeout } from './utils'

/**
 * Query thegraph's (https://thegraph.com) subgraphs via HTTP.
 * Connections will be retried and dropped after a timeout.
 * For the connection to be properly aborted, the fetch component supplied via IFetchComponent should support AbortController signals
 */
export async function createSubgraphComponent(
  components: createSubgraphComponent.NeededComponents,
  url: string
): Promise<ISubgraphComponent> {
  const { logs, metrics, config, fetch } = components

  const logger = logs.getLogger('thegraph-port')

  const RETRIES = (await config.getNumber('SUBGRAPH_COMPONENT_RETRIES')) ?? 3
  const TIMEOUT = (await config.getNumber('SUBGRAPH_COMPONENT_QUERY_TIMEOUT')) ?? 10000
  const TIMEOUT_INCREMENT = (await config.getNumber('SUBGRAPH_COMPONENT_TIMEOUT_INCREMENT')) ?? 10000
  const BACKOFF = (await config.getNumber('SUBGRAPH_COMPONENT_BACKOFF')) ?? 500
  const USER_AGENT = `Subgraph component / ${
    (await config.getString('SUBGRAPH_COMPONENT_AGENT_NAME')) ?? 'Unknown sender'
  }`

  /**
   * Public entry point for the component. Runs the query, retrying on failure up to
   * `remainingAttempts` times on top of the initial attempt.
   * @param query - The GraphQL query string.
   * @param variables - The query variables, if any.
   * @param remainingAttempts - How many retries to allow. Defaults to the configured RETRIES.
   */
  async function executeQuery<T>(
    query: string,
    variables: Variables = {},
    remainingAttempts: number = RETRIES
  ): Promise<T> {
    return attemptQuery<T>(query, variables, remainingAttempts, 0)
  }

  /**
   * Runs a single attempt and recurses on retry. `attempt` counts up from 0, independently of
   * `remainingAttempts`, so the per-attempt timeout escalation stays correct regardless of the
   * initial `remainingAttempts` the caller asks for — deriving the attempt number from `RETRIES`
   * used to produce a negative (i.e. immediate) timeout when `remainingAttempts > RETRIES`.
   */
  async function attemptQuery<T>(
    query: string,
    variables: Variables,
    remainingAttempts: number,
    attempt: number
  ): Promise<T> {
    const totalAttempts = attempt + Math.max(remainingAttempts, 0) + 1
    const currentAttempt = attempt + 1

    const timeoutWait = TIMEOUT + attempt * TIMEOUT_INCREMENT
    const queryId = randomUUID()
    const logData = { queryId, currentAttempt, attempts: totalAttempts, timeoutWait, url }

    const { end } = metrics.startTimer('subgraph_query_duration_seconds', { url })
    try {
      const [provider, response] = await withTimeout(
        (abortController) => postQuery<T>(query, variables, abortController),
        timeoutWait
      )

      const { data, errors } = response

      const hasErrors = errors !== undefined
      if (hasErrors) {
        const errorMessages = Array.isArray(errors) ? errors.map((error) => error.message) : [errors.message]
        throw new Error(
          `GraphQL Error: Invalid response. Errors:\n- ${errorMessages.join('\n- ')}. Provider: ${provider}`
        )
      }

      const hasInvalidData = !data || Object.keys(data).length === 0
      if (hasInvalidData) {
        throw new Error(`GraphQL Error: Invalid response. Provider: ${provider}`)
      }

      metrics.increment('subgraph_ok_total', { url })

      return data
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.warn('Error:', { ...logData, errorMessage, query, variables: JSON.stringify(variables) })

      let kind = 'unknown'
      if (errorMessage.includes('Failed to decode `block.number`')) {
        // An un-decodable block won't become decodable by retrying within the backoff window.
        kind = 'invalid_block'
        remainingAttempts = 0
      } else if (errorMessage.includes('Unexpected `')) {
        kind = 'syntax_error'
        remainingAttempts = 0
      } else if (
        error instanceof SubgraphQueryTimeoutError ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        kind = 'timeout'
      }
      metrics.increment('subgraph_errors_total', { url, kind })

      if (remainingAttempts > 0) {
        await setTimeout(BACKOFF)
        return attemptQuery<T>(query, variables, remainingAttempts - 1, attempt + 1)
      } else {
        throw error // bubble up
      }
    } finally {
      end({ url })
    }
  }

  async function postQuery<T>(
    query: string,
    variables: Variables,
    abortController: AbortController
  ): Promise<PostQueryResponse<T>> {
    const response = await fetch.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-agent': USER_AGENT },
      body: JSON.stringify({ query, variables }),
      abortController
    })

    const provider = response.headers.get('X-Subgraph-Provider') ?? UNKNOWN_SUBGRAPH_PROVIDER

    if (!response.ok) {
      throw new Error(`Invalid request. Status: ${response.status}. Provider: ${provider}.`)
    }

    return [provider, (await response.json()) as SubgraphResponse<T>]
  }

  return {
    query: executeQuery
  }
}

export namespace createSubgraphComponent {
  export type NeededComponents = {
    logs: ILoggerComponent
    config: IConfigComponent
    fetch: IFetchComponent
    metrics: IMetricsComponent<keyof typeof metricDeclarations>
  }
}
