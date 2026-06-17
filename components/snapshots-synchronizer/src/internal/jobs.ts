import { IBaseComponent, ILoggerComponent } from '@well-known-components/interfaces'
import PQueue from 'p-queue'
import { IJobWithLifecycle } from './job-lifecycle-manager'

/**
 * Runs jobs one at a time in FIFO order. Enqueuing while a job is running just appends; the running
 * chain re-arms itself in each job's `finally`, so the queue always drains.
 *
 * Distinct from {@link IJobQueue}: it runs lifecycle jobs serially and `stop()` actively *aborts* the
 * running job (the sync job runs an endless reconnection loop, so it must be cancelled, not awaited).
 */
export type SerialJobRunner = {
  enqueue(job: IJobWithLifecycle): void
  size(): number
  stop(): Promise<void>
}

export function createSerialJobRunner(logger: ILoggerComponent.ILogger): SerialJobRunner {
  const jobs: IJobWithLifecycle[] = []
  let stopped = false

  function startNext() {
    if (stopped || jobs.length === 0) {
      return
    }
    jobs[0]
      .start()
      .catch((err) => logger.error(err))
      .finally(() => {
        jobs.shift()
        startNext()
      })
  }

  return {
    enqueue(job: IJobWithLifecycle) {
      if (stopped) {
        return
      }
      jobs.push(job)
      if (jobs.length === 1) {
        startNext()
      }
    },
    size() {
      return jobs.length
    },
    async stop() {
      stopped = true
      const runningJob = jobs[0]
      jobs.length = 0
      if (runningJob) {
        await runningJob.stop()
      }
    }
  }
}

/**
 * A concurrency-limited queue for retrying fetch jobs (wraps p-queue). Internal to the synchronizer;
 * used to throttle and retry remote-server requests.
 *
 * Distinct from {@link SerialJobRunner}: it schedules bare promise thunks with bounded parallelism and
 * `stop()` *drains* the in-flight work (`onIdle`) rather than aborting it.
 */
export type IJobQueue = {
  scheduleJobWithRetries<T>(fn: () => Promise<T>, retries: number): Promise<T>
}

export type JobQueueOptions = {
  autoStart?: boolean
  concurrency?: number
  timeout?: number
}

export function createJobQueue(options: JobQueueOptions): IJobQueue & IBaseComponent {
  const realQueue = new PQueue({
    concurrency: options.concurrency,
    autoStart: options.autoStart ?? true,
    timeout: options.timeout
  })

  return {
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
