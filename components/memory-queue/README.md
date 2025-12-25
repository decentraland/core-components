# @dcl/memory-queue-component

In-memory queue component for local development and testing. Implements the `IQueueComponent` interface, providing a drop-in replacement for SQS without requiring AWS.

## Installation

```bash
npm install @dcl/memory-queue-component
```

## Usage

```typescript
import { createMemoryQueueComponent } from '@dcl/memory-queue-component'

const queue = createMemoryQueueComponent()
await queue.sendMessage({ type: 'user_created', userId: '123' })
const messages = await queue.receiveMessages(10)
```

## Configuration

```typescript
const queue = createMemoryQueueComponent({
  pollingDelayMs: 100, // Delay in ms when polling (default: 1000)
  wrapInSnsFormat: true // Wrap messages in SNS format (default: true)
})
```

## Features

- Drop-in replacement for SQS in local development
- Simulates visibility timeout behavior
- Configurable polling delay for testing
- Optional SNS format wrapping for message compatibility

## License

Apache-2.0
