import { ILoggerComponent } from '@well-known-components/interfaces'
import { IJobComponent, JobOptions } from './types'
import { WrongOnTimeError } from './errors'
import { createScheduledRunner } from './runner'

export function createJobComponent(
  components: Pick<{ logs: ILoggerComponent }, 'logs'>,
  /** The function to execute as a job. Admits asynchronous functions. */
  job: () => unknown,
  /** The amount of time in ms to wait between jobs */
  onTime: number,
  options: JobOptions = {}
): IJobComponent {
  if (!Number.isFinite(onTime) || onTime < 500) {
    throw new WrongOnTimeError(onTime)
  }

  return createScheduledRunner({
    logs: components.logs,
    job,
    nextDelayMs: () => onTime,
    options
  })
}
