# @dcl/sqs-component

AWS SQS component for queue message handling with Amazon Simple Queue Service.

## Installation

```bash
npm install @dcl/sqs-component
```

## Usage

```typescript
import { createSqsAdapter } from '@dcl/sqs-component'

const queue = await createSqsAdapter('https://sqs.us-east-1.amazonaws.com/...')
await queue.send(message)
const messages = await queue.receiveMessages(10)
```

## Local Development

For local development and testing without AWS, use the [@dcl/memory-queue-component](../memory-queue/README.md) package which provides an in-memory implementation of `IQueueComponent`:

```typescript
import { createMemoryQueueComponent } from '@dcl/memory-queue-component'

const queue = createMemoryQueueComponent()
await queue.sendMessage(message)
const messages = await queue.receiveMessages(10)
```

## Features

- Send messages to SQS queue
- Receive messages in batches
- Delete processed messages
- Long polling support
- Configurable visibility timeout

## License

MIT
