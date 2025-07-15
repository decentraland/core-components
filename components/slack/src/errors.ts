export class SlackWebhookUrlError extends Error {
  constructor() {
    super('SLACK_WEBHOOK_URL is required but not provided')
  }
}

export class SlackChannelError extends Error {
  constructor() {
    super('SLACK_CHANNEL is required but not provided')
  }
}
