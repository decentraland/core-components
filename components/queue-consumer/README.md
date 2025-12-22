# @dcl/queue-consumer-component

A message consumer component that orchestrates event handling from an SQS queue. It polls messages, routes them to registered handlers based on event type/subType, and manages graceful shutdown.

## Installation

```bash
npm install @dcl/queue-consumer-component
```

## Usage

```typescript
import { createMessagesHandlerComponent } from '@dcl/queue-consumer-component'
import { createSqsComponent } from '@dcl/sqs-component'
import { Events } from '@dcl/schemas'

// Create the component with required dependencies
const messagesHandler = createMessagesHandlerComponent(
  { sqs, logs },
  { releaseVisibilityTimeoutSeconds: 0 } // Optional: configure shutdown behavior
)

// Register handlers for specific event types
messagesHandler.addMessageHandler(Events.Type.CLIENT, Events.SubType.Client.LOGGED_IN, async (event) => {
  console.log('User logged in:', event.metadata.userId)
})

// Multiple handlers can be registered for the same type/subType
messagesHandler.addMessageHandler(Events.Type.CLIENT, Events.SubType.Client.LOGGED_IN, async (event) => {
  await analytics.track('login', event)
})

// Remove a handler when no longer needed
messagesHandler.removeMessageHandler(Events.Type.CLIENT, Events.SubType.Client.LOGGED_IN, myHandler)
```

## Features

- **Event-based routing**: Register handlers for specific `type`/`subType` combinations from `@dcl/schemas`
- **Multiple handlers**: Multiple handlers can be registered for the same event type and all execute in parallel
- **Automatic message deletion**: Messages are deleted after processing (regardless of handler success/failure)
- **Graceful shutdown**: On stop, remaining unprocessed messages have their visibility timeout changed to make them available for other consumers
- **Exponential backoff**: Automatic retry with backoff when queue polling fails
- **Error isolation**: Handler errors are logged but don't affect other handlers or message processing

## Configuration

| Option                            | Type     | Default | Description                                                                                                  |
| --------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `releaseVisibilityTimeoutSeconds` | `number` | `0`     | Visibility timeout (in seconds) for unprocessed messages on shutdown. Set to `0` for immediate availability. |

## License

Apache-2.0
