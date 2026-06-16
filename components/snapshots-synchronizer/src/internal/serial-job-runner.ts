import { ILoggerComponent } from '@well-known-components/interfaces'
import { IJobWithLifecycle } from './job-lifecycle-manager'

/**
 * Runs jobs one at a time in FIFO order. Enqueuing while a job is running just appends; the running
 * chain re-arms itself in each job's `finally`, so the queue always drains.
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
