# @dcl/sns-component

AWS SNS component for publishing messages to Amazon Simple Notification Service.

## Installation

```bash
npm install @dcl/sns-component
```

## Usage

```typescript
import { createSnsComponent } from '@dcl/sns-component'

const snsPublisher = await createSnsComponent({ config })
await snsPublisher.publishMessages([event1, event2])
```

## Configuration

The component requires the following environment variables:

- `AWS_SNS_ARN`: The ARN of the SNS topic
- `AWS_SNS_ENDPOINT` (optional): Custom SNS endpoint for testing

## Features

- Batch message publishing (up to 10 messages per batch)
- Automatic retry handling
- Type-safe message attributes
- Error reporting for failed messages

## License

MIT
