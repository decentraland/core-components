import { isErrorWithMessage } from '@dcl/core-commons'
import { AnalyticsEvent, Environment, IAnalyticsComponent, IAnalyticsDependencies } from './types'

export async function createAnalyticsComponent(
  components: Pick<IAnalyticsDependencies, 'fetch' | 'logs'>,
  context: string,
  env: Environment,
  analyticsApiUrl: string,
  analyticsApiToken: string
): Promise<IAnalyticsComponent> {
  const { fetch, logs } = components
  const logger = logs.getLogger('analytics-component')

  async function sendEvent(event: AnalyticsEvent): Promise<void> {
    logger.info(`Sending event to Analytics ${event.event}`)

    try {
      const response = await fetch.fetch(analyticsApiUrl, {
        method: 'POST',
        headers: {
          'x-token': analyticsApiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          context,
          ...event,
          body: {
            ...event.body,
            env
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Got status ${response.status} from the Analytics API`)
      }
    } catch (error) {
      logger.error(`Error sending event to Analytics ${event.event}`, {
        error: isErrorWithMessage(error) ? error.message : 'Unknown error'
      })
    }
  }

  return {
    sendEvent
  }
}
