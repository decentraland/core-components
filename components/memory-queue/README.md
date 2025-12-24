# @dcl/memory-queue-component

In-memory queue component for local development and testing. Implements the `IQueueComponent` interface, providing a drop-in replacement for queue implementations like SQS without requiring external services.

## Installation

```bash
npm install @dcl/memory-queue-component
```

## Usage

### Basic Usage

```typescript
import { createMemoryQueueComponent } from '@dcl/memory-queue-component'

// Create an in-memory queue
const queue = createMemoryQueueComponent()

// Send a message
await queue.sendMessage({ type: 'user_created', userId: '123' })

// Receive messages
const messages = await queue.receiveMessages(10)

// Process and delete
for (const message of messages) {
  const body = JSON.parse(message.Body)
  const payload = JSON.parse(body.Message) // SNS format by default
  console.log(payload)
  await queue.deleteMessage(message.ReceiptHandle)
}
```

### Custom Options

```typescript
const queue = createMemoryQueueComponent({
  // Delay in milliseconds when polling for messages (default: 1000)
  pollingDelayMs: 100,
  
  // Whether to wrap messages in SNS format (default: true)
  // Set to false if you don't need SNS format compatibility
  wrapInSnsFormat: true
})
```

### Testing Example

```typescript
import { createMemoryQueueComponent, IQueueComponent } from '@dcl/memory-queue-component'

describe('MyService', () => {
  let queue: IQueueComponent

  beforeEach(() => {
    // Use a short polling delay for faster tests
    queue = createMemoryQueueComponent({ pollingDelayMs: 10 })
  })

  it('should process messages', async () => {
    await queue.sendMessage({ type: 'test', id: 123 })
    
    const messages = await queue.receiveMessages(1)
    expect(messages).toHaveLength(1)
    
    const body = JSON.parse(messages[0].Body)
    const payload = JSON.parse(body.Message)
    expect(payload.type).toBe('test')
  })
})
```

### Visibility Timeout

The component simulates SQS visibility timeout behavior. When messages are received, they become invisible for a configurable period:

```typescript
const queue = createMemoryQueueComponent({ pollingDelayMs: 10 })

await queue.sendMessage({ type: 'test' })

// Receive with custom visibility timeout
const messages = await queue.receiveMessages(1, { visibilityTimeout: 60 })

// Message is now invisible for 60 seconds
// Other consumers won't see it

// Change visibility timeout if needed
await queue.changeMessageVisibility(messages[0].ReceiptHandle, 0) // Make visible immediately
```

## API Reference

### IQueueComponent Interface

```typescript
interface IQueueComponent {
  sendMessage(message: unknown): Promise<void>
  receiveMessages(amount?: number, options?: ReceiveMessagesOptions): Promise<QueueMessage[]>
  deleteMessage(receiptHandle: string): Promise<void>
  deleteMessages(receiptHandles: string[]): Promise<void>
  changeMessageVisibility(receiptHandle: string, visibilityTimeout: number): Promise<void>
  changeMessagesVisibility(receiptHandles: string[], visibilityTimeout: number): Promise<void>
  getStatus(): Promise<QueueStatus>
}
```

### ReceiveMessagesOptions

```typescript
interface ReceiveMessagesOptions {
  visibilityTimeout?: number  // Seconds before message becomes visible again (default: 30)
  waitTimeSeconds?: number    // Long-polling wait time in seconds
  abortSignal?: AbortSignal   // For cancelling requests
}
```

### QueueMessage

```typescript
interface QueueMessage {
  MessageId: string
  ReceiptHandle: string
  Body: string
}
```

### QueueStatus

```typescript
interface QueueStatus {
  ApproximateNumberOfMessages: string
  ApproximateNumberOfMessagesNotVisible: string
  ApproximateNumberOfMessagesDelayed: string
}
```

### MemoryQueueOptions

```typescript
interface MemoryQueueOptions {
  pollingDelayMs?: number     // Delay in ms when polling (default: 1000)
  wrapInSnsFormat?: boolean   // Wrap messages in SNS format (default: true)
}
```

## Features

- Drop-in replacement for SQS in local development
- Simulates visibility timeout behavior
- Configurable polling delay for testing
- Optional SNS format wrapping for message compatibility
- Full `IQueueComponent` interface implementation
- No external dependencies (except `@dcl/core-commons` for utilities)

## License

Apache-2.0

