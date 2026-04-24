import { isErrorWithMessage } from '@dcl/core-commons'
import { AnalyticsEventMap, IAnalyticsComponent, IAnalyticsDependencies } from './types'

const DEFAULT_REQUEST_TIMEOUT_MS = 10000

export async function createAnalyticsComponent<T extends AnalyticsEventMap>(
  components: Pick<IAnalyticsDependencies, 'fetcher' | 'logs' | 'config'>
): Promise<IAnalyticsComponent<T>> {
  const { fetcher, logs, config } = components
  const logger = logs.getLogger('analytics-component')
  const context = await config.requireString('ANALYTICS_CONTEXT')
  const analyticsApiUrl = await config.requireString('ANALYTICS_API_URL')
  const analyticsApiToken = await config.requireString('ANALYTICS_API_TOKEN')
  const env = await config.requireString('ENV')
  const configuredTimeout = await config.getNumber('ANALYTICS_REQUEST_TIMEOUT')
  const hasValidConfiguredTimeout =
    typeof configuredTimeout === 'number' && Number.isFinite(configuredTimeout) && configuredTimeout > 0
  if (configuredTimeout !== undefined && !hasValidConfiguredTimeout) {
    logger.warn(
      `ANALYTICS_REQUEST_TIMEOUT value "${configuredTimeout}" is invalid; using default ${DEFAULT_REQUEST_TIMEOUT_MS}ms`
    )
  }
  const requestTimeout = hasValidConfiguredTimeout ? (configuredTimeout as number) : DEFAULT_REQUEST_TIMEOUT_MS

  async function _sendEvent<K extends keyof T>(name: K, body: T[K]): Promise<void> {
    try {
      const response = await fetcher.fetch(analyticsApiUrl, {
        method: 'POST',
        timeout: requestTimeout,
        headers: {
          'x-token': analyticsApiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event: name,
          body: {
            ...body,
            env
          },
          context
        })
      })

      if (!response.ok) {
        throw new Error(`Got status ${response.status} from the Analytics API`)
      }
    } catch (error) {
      logger.error(`Error sending event to Analytics ${String(name)}`, {
        error: isErrorWithMessage(error) ? error.message : 'Unknown error'
      })
    }
  }

  function fireEvent<K extends keyof T>(name: K, body: T[K]): void {
    void _sendEvent(name, body)
  }

  async function sendEvent<K extends keyof T>(name: K, body: T[K]): Promise<void> {
    return _sendEvent(name, body)
  }

  return {
    sendEvent,
    fireEvent
  }
}
