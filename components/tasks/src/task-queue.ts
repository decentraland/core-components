import { IBaseComponent } from '@well-known-components/interfaces'
import PQueue from 'p-queue'
import { InvalidRetriesError } from './errors'

/**
 * A concurrency-limited queue for retrying fetch/work jobs (wraps p-queue). Schedules bare promise
 * thunks with bounded parallelism; `stop()` *drains* the in-flight work (`onIdle`) rather than
 * aborting it.
 */
export type ITaskQueue = {
  scheduleWithRetries<T>(fn: () => Promise<T>, retries: number): Promise<T>
}

export type TaskQueueOptions = {
  autoStart?: boolean
  concurrency?: number
  timeout?: number
}

export function createTaskQueue(options: TaskQueueOptions): ITaskQueue & IBaseComponent {
  const realQueue = new PQueue({
    concurrency: options.concurrency,
    autoStart: options.autoStart ?? true,
    timeout: options.timeout
  })

  return {
    scheduleWithRetries<T>(fn: () => Promise<T>, retries: number): Promise<T> {
      if (!(retries | 0)) {
        throw new InvalidRetriesError()
      }
      return new Promise<T>((resolve, reject) => {
        function schedule(remaining: number) {
          realQueue
            .add(async () => {
              try {
                resolve(await fn())
              } catch (e: any) {
                if (remaining <= 0) {
                  reject(e)
                } else {
                  schedule(remaining - 1)
                }
              }
            })
            .catch(reject)
        }
        schedule(retries)
      })
    },
    async stop() {
      await realQueue.onIdle()
    }
  }
}
