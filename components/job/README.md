# Job Component (`@dcl/job-component`)

A component for scheduling and executing recurring jobs with configurable timing and error handling.

## Features

- Recurring job execution with configurable intervals
- Startup delay support
- Error handling and completion callbacks
- Graceful shutdown capabilities

## Usage

```typescript
import { createJobComponent } from '@dcl/job-component'

const job = createJobComponent(
  { logs },
  async () => {
    // Your job logic here
    console.log('Executing job...')
  },
  5000, // Run every 5 seconds
  {
    repeat: true,
    startupDelay: 1000,
    onError: (error) => console.error('Job error:', error),
    onFinish: () => console.log('Job finished')
  }
)
```
