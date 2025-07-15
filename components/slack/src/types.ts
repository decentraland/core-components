import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'

export interface SlackConfig {
  webhookUrl?: string
  token?: string
}

export interface SlackMessage {
  text?: string
  blocks?: any[]
  attachments?: any[]
  channel?: string
  username?: string
  icon_emoji?: string
  icon_url?: string
  thread_ts?: string
  reply_broadcast?: boolean
}

export interface ISlackComponent {
  sendMessage(message: SlackMessage): Promise<void>
  [START_COMPONENT]: () => Promise<void>
  [STOP_COMPONENT]: () => Promise<void>
}
