import { START_COMPONENT, STOP_COMPONENT, ILoggerComponent } from '@well-known-components/interfaces'
import { IncomingWebhook } from '@slack/webhook'
import { WebClient } from '@slack/web-api'
import { SlackConfig, SlackMessage, ISlackComponent } from './types'

export function createSlackComponent(
  components: Pick<{ logs: ILoggerComponent }, 'logs'>,
  config: SlackConfig
): ISlackComponent {
  const { logs } = components
  const logger = logs?.getLogger?.('slack')
  let webhookUrl: string | undefined = config.webhookUrl
  let token: string | undefined = config.token
  let client: WebClient | undefined

  if (token) {
    client = new WebClient(token)
  }

  async function sendMessage(message: SlackMessage): Promise<void> {
    try {
      if (!webhookUrl && !token) {
        throw new Error('No webhook URL or token provided')
      }
      if (token && client && !message.channel) {
        throw new Error('Channel is required when using token')
      }
      if (token && client) {
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
      } else if (webhookUrl) {
        const webhook = new IncomingWebhook(webhookUrl)
        await webhook.send({
          text: message.text,
          blocks: message.blocks,
          attachments: message.attachments
        })
      }
    } catch (error) {
      throw new Error(`Failed to send message: ${error}`)
    }
  }

  return {
    sendMessage
  }
}
