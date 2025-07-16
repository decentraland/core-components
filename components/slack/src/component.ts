import { START_COMPONENT, STOP_COMPONENT, ILoggerComponent } from '@well-known-components/interfaces'
import { IncomingWebhook } from '@slack/webhook'
import { WebClient } from '@slack/web-api'
import { SlackConfig, SlackMessage, ISlackComponent } from './types'

export function createSlackComponent(
  components: Pick<{ logs: ILoggerComponent }, 'logs'>,
  config: SlackConfig
): ISlackComponent {
  const { logs } = components
  const logger = logs.getLogger('slack')
  let token: string | undefined = config.token

  if (!token) {
    logger.error('No token provided')
    throw new Error('No token provided')
  }

  const client = new WebClient(token)

  async function sendMessage(message: SlackMessage): Promise<void> {
    try {
      if (!message.channel) {
        throw new Error('Channel is required when using token')
      }

      await client.chat.postMessage({
        channel: message.channel!,
        text: message.text,
        blocks: message.blocks,
        attachments: message.attachments,
        username: message.username,
        icon_emoji: message.icon_emoji,
        icon_url: message.icon_url,
        thread_ts: message.thread_ts,
        reply_broadcast: message.reply_broadcast
      })
    } catch (error) {
      logger.debug(`Failed to send message: ${error}`)
      throw new Error(`Failed to send message: ${error}`)
    }
  }

  return {
    sendMessage
  }
}
