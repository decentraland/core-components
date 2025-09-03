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

## Features

- Send messages to SQS queue
- Receive messages in batches
- Delete processed messages
- Long polling support
- Configurable visibility timeout

## License

MIT
