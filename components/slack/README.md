# @dcl/slack-component

A component for sending messages to Slack using bot tokens, following the best practices from the official Slack documentation.

## Features

- Send messages to Slack using bot tokens
- Support for simple text messages and complex messages with blocks and attachments
- Improved TypeScript types based on official Slack documentation
- Message validation according to Slack specifications
- Robust error handling with detailed logging
- Flexible channel and message options configuration
- Compatible with TypeScript 5.3.x and Node.js >= 18.0.0

## Installation

```bash
pnpm add @dcl/slack-component
```

## Configuration

The component requires a bot token for authentication and message sending.

## Usage

### Create the component

```typescript
import { createSlackComponent } from '@dcl/slack-component'

// Using bot token
const slack = createSlackComponent(
  { logs },
  {
    token: 'xoxb-your-bot-token'
  }
)
```

### Send messages

```typescript
// Send simple text message
await slack.sendMessage({
  text: 'Hello from DCL!',
  channel: '#general'
})

// Send to specific channel with customization
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
  channel: '#notifications',
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
  channel: '#errors',
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

### `sendMessage(message: SlackMessage): Promise<void>`

Send a message to Slack and wait for the response.

## Types

### `SlackMessage`

```typescript
interface SlackMessage {
  text?: string
  blocks?: any[]
  attachments?: any[]
  channel: string
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
  token: string
}
```

## Bot Token Setup

To use this component, you need to:

1. **Create a Slack App** at https://api.slack.com/apps
2. **Configure Bot Token Scopes**:
   - `chat:write` - for sending messages to channels
   - `chat:write.public` - for sending messages to public channels
   - `chat:write.customize` - for customizing bot name and avatar
3. **Install the app** to your workspace
4. **Get the Bot User OAuth Token** (starts with `xoxb-`)

## Error Handling

The component automatically handles errors and logs them using the logging system. Common errors include:

- `No token provided` - when token is missing from configuration
- `Channel is required when using token` - when channel is not specified
- `Failed to send message` - when API call fails (network, permissions, etc.)

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

## Improvements Based on Official Documentation

This component follows the best practices from the [official Slack documentation](https://tools.slack.dev/node-slack-sdk/typescript/):

- Improved and complete TypeScript types
- Message validation according to Slack specifications
- Robust error handling
- Compatibility with the latest TypeScript versions
- Uses official Slack API library
- Implements standard component lifecycle methods
