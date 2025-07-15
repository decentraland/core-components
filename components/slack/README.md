# @dcl/slack-component

A component for sending messages to Slack using webhooks or bot tokens, following the best practices from the official Slack documentation.

## Features

- Send messages to Slack using webhooks or bot tokens
- Support for simple text messages and complex messages with blocks and attachments
- Improved TypeScript types based on official Slack documentation
- Message validation according to Slack specifications
- Robust error handling with detailed logging
- Flexible channel and message options configuration
- Compatible with TypeScript 5.3.x and Node.js >= 18.0.0
- Implements START_COMPONENT and STOP_COMPONENT lifecycle methods

## Installation

```bash
pnpm add @dcl/slack-component
```

## Configuration

The component requires either a webhook URL or a bot token:

- **Webhook**: Simple integration, limited customization
- **Bot Token**: Full customization including username, icon, and advanced features

## Usage

### Create the component

```typescript
import { createSlackComponent } from '@dcl/slack-component'

// Using webhook (simple integration)
const slack = createSlackComponent(
  { logs },
  {
    webhookUrl: 'https://hooks.slack.com/services/XXX/YYY/ZZZ'
  }
)

// Using bot token (full customization)
const slack = createSlackComponent(
  { logs },
  {
    token: 'xoxb-your-bot-token'
  }
)
```

### Start and stop the component

```typescript
// Start the component
await slack[START_COMPONENT]?.({})

// Stop the component
await slack[STOP_COMPONENT]?.()
```

### Send messages

```typescript
// Send simple text message
await slack.sendMessage({ text: 'Hello from DCL!' })

// Send to specific channel (requires bot token)
await slack.sendMessage({
  channel: '#alerts',
  text: 'Important alert!',
  username: 'My Bot',
  icon_emoji: ':rocket:',
  icon_url: 'https://example.com/icon.png'
})

// Send complex message with blocks
await slack.sendMessage({
  text: 'Backup message',
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Important message*\nThis is a formatted message'
      }
    }
  ]
})

// Send message with attachments
await slack.sendMessage({
  text: 'Error report',
  attachments: [
    {
      color: '#ff0000',
      fields: [
        {
          title: 'Error',
          value: 'Database connection failed',
          short: true
        }
      ]
    }
  ]
})
```

## API

### `[START_COMPONENT]?(startOptions: IBaseComponent.ComponentStartOptions): Promise<void>`

Start the Slack component. Logs that the component has started.

### `[STOP_COMPONENT]?(): Promise<void>`

Stop the Slack component. Logs that the component has stopped.

### `sendMessage(message: SlackMessage): Promise<void>`

Send a message to Slack and wait for the response.

## Types

### `SlackMessage`

```typescript
interface SlackMessage {
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
```

### `SlackConfig`

```typescript
interface SlackConfig {
  webhookUrl?: string
  token?: string
}
```

## Webhook vs Bot Token

### Webhook Limitations

- Cannot customize `username`, `icon_emoji`, or `icon_url`
- Uses the name and icon configured in the webhook integration
- Simpler setup, good for basic integrations

### Bot Token Features

- Full customization of `username`, `icon_emoji`, and `icon_url`
- Access to all Slack API features
- Requires bot token setup and proper permissions

## Error Handling

The component automatically handles errors and logs them using the logging system. Errors include:

- Network and other communication errors
- Configuration errors when neither webhook nor token is provided

## Compatibility

- **TypeScript**: 5.3.x or higher
- **Node.js**: 18.0.0 or higher
- **Slack API**: Compatible with the latest Slack API version

## Testing

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test --watch
```

## Development

```bash
# Build the component
pnpm build

# Development in watch mode
pnpm dev

# Clean build files
pnpm clean
```

## Improvements Based on Official Documentation

This component follows the best practices from the [official Slack documentation](https://tools.slack.dev/node-slack-sdk/typescript/):

- Improved and complete TypeScript types
- Message validation according to Slack specifications
- Robust error handling
- Compatibility with the latest TypeScript versions
- Uses official Slack webhook and API libraries
- Implements standard component lifecycle methods
