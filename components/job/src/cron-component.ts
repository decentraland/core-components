import { ILoggerComponent } from '@well-known-components/interfaces'
import { CronExpressionParser, CronExpression } from 'cron-parser'
import { CronSchedule, IJobComponent, JobOptions } from './types'
import { InvalidCronExpressionError } from './errors'
import { createScheduledRunner } from './runner'

export function createCronJobComponent(
  components: Pick<{ logs: ILoggerComponent }, 'logs'>,
  /** The function to execute as a job. Admits asynchronous functions. */
  job: () => unknown,
  /** The cron schedule describing when the job should fire. */
  schedule: CronSchedule,
  options: JobOptions = {}
): IJobComponent {
  let expression: CronExpression
  try {
    expression = CronExpressionParser.parse(schedule.cron, { tz: schedule.timezone })
  } catch (cause) {
    throw new InvalidCronExpressionError(schedule.cron, cause)
  }

  if (schedule.skipFirstRun && typeof options.startupDelay === 'number' && options.startupDelay > 0) {
    components.logs
      .getLogger('cron-job')
      .warn('Both skipFirstRun and startupDelay are set; startupDelay is ignored in favor of the next cron match')
  }

  function computeNextDelayMs(): number {
    expression.reset(new Date())
    return expression.next().getTime() - Date.now()
  }

  return createScheduledRunner({
    logs: components.logs,
    loggerName: 'cron-job',
    job,
    nextDelayMs: computeNextDelayMs,
    initialDelayMs: schedule.skipFirstRun ? computeNextDelayMs : undefined,
    options
  })
}
