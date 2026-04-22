import { IBaseComponent } from '@well-known-components/interfaces'

export type IJobComponent = IBaseComponent

export type JobOptions = {
  /** Sets if the job will be run repeatedly or once */
  repeat?: boolean
  /** Sets if the job will wait for a specific amount of time in ms before starting for the first time */
  startupDelay?: number
  /** Sets a function to be executed if the job fails */
  onError?: (error: unknown) => void
  /**
   * Executes a function when the component's run loop exits (whether iterations ran or not).
   * Also fires if the component is stopped during its startup sleep, before the first iteration.
   * May be async; the runner awaits its result before resolving `stop()`.
   */
  onFinish?: () => void | Promise<void>
}

export type CronSchedule = {
  /** A cron expression (5- or 6-field) describing when the job should fire. */
  cron: string
  /** Optional IANA timezone used for cron evaluation. Defaults to UTC. */
  timezone?: string
  /**
   * If true, the job waits for the next cron match before its first run.
   * If false (default), the job runs immediately after `startupDelay` and then sleeps until each subsequent cron match.
   * Note: `startupDelay` is still validated (`>= 0`) even when this flag supersedes its effect.
   */
  skipFirstRun?: boolean
}
