import { ILoggerComponent } from '@well-known-components/interfaces'
import { ITaskWithLifecycle } from './types'

/**
 * Runs tasks one at a time in FIFO order. Enqueuing while a task is running just appends; the running
 * chain re-arms itself in each task's `finally`, so the queue always drains.
 *
 * Distinct from {@link ITaskQueue}: it runs lifecycle tasks serially and `stop()` actively *aborts* the
 * running task (a sync/reconnection task runs an endless loop, so it must be cancelled, not awaited).
 */
export type SerialTaskRunner = {
  enqueue(task: ITaskWithLifecycle): void
  size(): number
  stop(): Promise<void>
}

export function createSerialTaskRunner(logger: ILoggerComponent.ILogger): SerialTaskRunner {
  const tasks: ITaskWithLifecycle[] = []
  let stopped = false

  function startNext() {
    if (stopped || tasks.length === 0) {
      return
    }
    tasks[0]
      .start()
      .catch((err) => logger.error(err))
      .finally(() => {
        tasks.shift()
        startNext()
      })
  }

  return {
    enqueue(task: ITaskWithLifecycle) {
      if (stopped) {
        return
      }
      tasks.push(task)
      if (tasks.length === 1) {
        startNext()
      }
    },
    size() {
      return tasks.length
    },
    async stop() {
      stopped = true
      const runningTask = tasks[0]
      tasks.length = 0
      if (runningTask) {
        await runningTask.stop()
      }
    }
  }
}
