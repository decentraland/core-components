# Job Component (`@dcl/job-component`)

Two factories for scheduling and executing jobs with configurable timing and error handling.

## Features

- Fixed-interval recurring execution via `createJobComponent`
- Cron-expression recurring execution via `createCronJobComponent`
- Startup delay support
- Error handling and completion callbacks
- Graceful shutdown via `STOP_COMPONENT`

## Interval mode

```typescript
import { createJobComponent } from '@dcl/job-component'

const job = createJobComponent(
  { logs },
  async () => {
    // Your job logic here
  },
  5000, // Run every 5 seconds (minimum 500ms)
  {
    repeat: true,
    startupDelay: 1000,
    onError: (error) => console.error('Job error:', error),
    onFinish: () => console.log('Job finished')
  }
)
```

## Cron mode

```typescript
import { createCronJobComponent } from '@dcl/job-component'

const job = createCronJobComponent(
  { logs },
  async () => {
    // Your job logic here
  },
  { cron: '0 3 * * *', timezone: 'UTC' }, // Every day at 03:00 UTC
  {
    repeat: true,
    startupDelay: 0,
    onError: (error) => console.error('Job error:', error),
    onFinish: () => console.log('Job finished')
  }
)
```

Cron expressions are parsed by [`cron-parser`](https://www.npmjs.com/package/cron-parser) and support both 5- and 6-field forms plus predefined aliases (`@hourly`, `@daily`, etc.). The next fire time is recomputed from the current clock after each run, so late or long-running jobs drop missed ticks instead of stampeding. An invalid expression throws `InvalidCronExpressionError` at construction.

By default, the job runs **immediately** after `startupDelay` and only waits until the next cron match for subsequent iterations. Pass `skipFirstRun: true` on the schedule to instead wait until the first matching cron time before the first run:

```typescript
const job = createCronJobComponent(
  { logs },
  async () => { /* ... */ },
  { cron: '0 3 * * *', timezone: 'UTC', skipFirstRun: true }
)
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `repeat` | `true` | Run repeatedly or once. |
| `startupDelay` | `0` | Milliseconds to wait before the first run. |
| `onError` | no-op | Called with the thrown error if a job run rejects. |
| `onFinish` | no-op | Called once after the loop exits (either `repeat: false` completes or `STOP_COMPONENT` is invoked). |
