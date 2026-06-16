import { IBaseComponent } from '@well-known-components/interfaces'
import PQueue from 'p-queue'

/** A concurrency-limited job queue (wraps p-queue). Internal to the synchronizer. */
export type IJobQueue = {
  scheduleJob<T>(fn: () => Promise<T>): Promise<T>
  onSizeLessThan(limit: number): Promise<void>
  scheduleJobWithRetries<T>(fn: () => Promise<T>, retries: number): Promise<T>
  scheduleJobWithPriority<T>(fn: () => Promise<T>, priority: number): Promise<T>
  onIdle(): Promise<void>
}

export function createJobQueue(options: createJobQueue.Options): IJobQueue & IBaseComponent {
  const realQueue = new PQueue({
    concurrency: options.concurrency,
    autoStart: options.autoStart ?? true,
    timeout: options.timeout
  })

  return {
    onIdle() {
      return realQueue.onIdle()
    },
    scheduleJob<T>(fn: () => Promise<T>): Promise<T> {
      return realQueue.add(fn)
    },
    async onSizeLessThan(limit: number): Promise<void> {
      if (realQueue.size < limit) {
        return
      }
      return new Promise((resolve) => {
        const listener = () => {
          if (realQueue.size < limit) {
            realQueue.off('next', listener)
            resolve()
          }
        }
        realQueue.on('next', listener)
      })
    },
    scheduleJobWithPriority<T>(fn: () => Promise<T>, priority: number): Promise<T> {
      return realQueue.add(fn, { priority })
    },
    scheduleJobWithRetries<T>(fn: () => Promise<T>, retries: number): Promise<T> {
      if (!(retries | 0)) {
        throw new Error('At least one retry is required')
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

export namespace createJobQueue {
  export type Options = {
    autoStart?: boolean
    concurrency?: number
    timeout?: number
  }
}
