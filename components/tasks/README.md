# @dcl/tasks-component

Generic, domain-agnostic task-scheduling primitives. All revolve around a single interface,
`ITaskWithLifecycle` (`start()` / `stop()`).

## Primitives

- **`createTaskQueue(options)`** — a concurrency-limited queue (wraps `p-queue`) that runs promise
  thunks with bounded parallelism. `scheduleWithRetries(fn, retries)` retries a failing job up to
  `retries` times. `stop()` drains the in-flight work.

- **`createSerialTaskRunner(logger)`** — runs `ITaskWithLifecycle` tasks one at a time in FIFO order.
  `stop()` actively *aborts* the running task (it does not wait for it to finish), which is what
  endless reconnection loops need.

- **`createTaskLifecycleManagerComponent({ logs }, options)`** — keeps a set of named long-running
  tasks reconciled to a desired set: `setDesiredTasks(names)` starts tasks for new names and stops
  tasks for dropped ones.

- **`createExponentialBackoffRetry(logger, options)`** — runs an `action()` over and over until
  stopped, backing off exponentially between failures (interruptible, so `stop()` cancels an
  in-flight wait immediately).

## Usage

```ts
import {
  createTaskQueue,
  createSerialTaskRunner,
  createTaskLifecycleManagerComponent,
  createExponentialBackoffRetry
} from '@dcl/tasks-component'

const queue = createTaskQueue({ autoStart: true, concurrency: 10, timeout: 60_000 })
const result = await queue.scheduleWithRetries(() => fetchSomething(), 3)

const retry = createExponentialBackoffRetry(logger, {
  action: async () => pollOnce(),
  retryTime: 1000,
  retryTimeExponent: 1.5,
  maxInterval: 3_600_000
})
await retry.start()
```
