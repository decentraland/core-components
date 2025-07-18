# Slack Component (`@dcl/slack-component`)

A component for sending messages to Slack using bot tokens.

## Features

- Send messages to Slack using bot tokens
- Support for simple and complex messages (blocks, attachments)
- Error handling and logging
- Flexible channel and message options configuration
- Lifecycle methods for start/stop

## Usage

```typescript
import { createSlackComponent } from '@dcl/slack-component'

// Send to specific channel with custom username and icon (requires bot token)
const slackWithToken = createSlackComponent({ logs }, { token: 'xoxb-your-bot-token' })
await slackWithToken.sendMessage({
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

- `Failed to send message` - when API call fails (network, permissions, etc.)

## Compatibility

- **TypeScript**: 5.3.x or higher
- **Node.js**: 18.0.0 or higher
- **Slack API**: Compatible with the latest Slack API version
