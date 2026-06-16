import { IBaseComponent, ILoggerComponent } from '@well-known-components/interfaces'

export type JobLifecycleManagerComponent = {
  setDesiredJobs(desiredJobNames: Set<string>): void
  getRunningJobs(): Set<string>
}

export type IJobWithLifecycle = {
  // once start() finishes, the job ends
  start(): Promise<void>
  // should trigger the signal to end the job
  stop(): Promise<void>
}

export type JobLifecycleManagerOptions = {
  jobManagerName: string
  createJob(jobName: string): IJobWithLifecycle
}

/**
 * Handles a list of running jobs. Each call to setDesiredJobs creates a job per name not already
 * running, and stops jobs no longer desired.
 */
export function createJobLifecycleManagerComponent(
  components: { logs: ILoggerComponent },
  options: JobLifecycleManagerOptions
): IBaseComponent & JobLifecycleManagerComponent {
  const logs = components.logs.getLogger(options.jobManagerName)
  const createdJobs = new Map<string, IJobWithLifecycle>()

  return {
    setDesiredJobs(desiredJobNames: Set<string>): void {
      for (const [name, job] of createdJobs) {
        if (!desiredJobNames.has(name)) {
          logs.info('Stopping job', { name })
          job.stop().catch((err) => logs.error(err))
          createdJobs.delete(name)
        }
      }

      for (const name of desiredJobNames) {
        if (!createdJobs.has(name)) {
          logs.info('Creating job', { name })
          const job = options.createJob(name)
          createdJobs.set(name, job)
          job
            .start()
            .catch((err) => logs.error(err))
            .finally(() => {
              if (createdJobs.get(name) === job) {
                logs.info('Job finished', { name })
                createdJobs.delete(name)
              }
            })
        }
      }
    },
    getRunningJobs() {
      return new Set(createdJobs.keys())
    },
    async stop() {
      for (const [name, job] of createdJobs) {
        logs.info('Stopping job', { name })
        try {
          await job.stop()
        } catch (e: any) {
          logs.error(e)
        }
        createdJobs.delete(name)
      }
    }
  }
}
