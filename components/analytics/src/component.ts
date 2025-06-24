import { isErrorWithMessage } from '@dcl/core-commons'
import { Environment, IAnalyticsComponent, IAnalyticsDependencies } from './types'

export async function createAnalyticsComponent(
  components: Pick<IAnalyticsDependencies, 'fetch' | 'logs'>,
  context: string,
  env: Environment,
  analyticsApiUrl: string,
  analyticsApiToken: string
): Promise<IAnalyticsComponent> {
  const { fetch, logs } = components
  const logger = logs.getLogger('analytics-component')

  async function sendEvent(name: string, body: Record<string, any>): Promise<void> {
    logger.info(`Sending event to Analytics ${name}`)

    try {
      const response = await fetch.fetch(analyticsApiUrl, {
        method: 'POST',
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
      logger.error(`Error sending event to Analytics ${name}`, {
        error: isErrorWithMessage(error) ? error.message : 'Unknown error'
      })
    }
  }

  return {
    sendEvent
  }
}
