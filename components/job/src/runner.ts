import { isErrorWithMessage } from '@dcl/core-commons'
import { START_COMPONENT, STOP_COMPONENT, ILoggerComponent, IBaseComponent } from '@well-known-components/interfaces'
import { JobOptions } from './types'
import { InvalidStartupDelayError } from './errors'

const FALLBACK_NEXT_DELAY_MS = 60_000

export type ScheduledRunnerConfig = {
  logs: ILoggerComponent
  job: () => unknown
  /** Called after each job iteration to compute the delay (ms) before the next run. */
  nextDelayMs: () => number
  /** If provided, used instead of options.startupDelay for the very first sleep. Evaluated at start(). */
  initialDelayMs?: () => number
  loggerName?: string
  options: JobOptions
}

export function createScheduledRunner(config: ScheduledRunnerConfig): IBaseComponent {
  const { logs, job, nextDelayMs, initialDelayMs } = config
  const {
    repeat = true,
    startupDelay = 0,
    onError = () => undefined,
    onFinish = () => undefined
  } = config.options

  if (startupDelay < 0) {
    throw new InvalidStartupDelayError(startupDelay)
  }

  const logger = logs.getLogger(config.loggerName ?? 'job')
  let runJobPromise: Promise<void> = Promise.resolve()
  let hasStarted = false
  let shouldStop = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let resolveSleepCancel: ((value: unknown) => void) | undefined

  async function sleep(time: number) {
    return new Promise((resolve) => {
      resolveSleepCancel = resolve
      timeout = setTimeout(() => {
        resolveSleepCancel = undefined
        timeout = undefined
        resolve(undefined)
      }, time)
    })
  }

  function cancelSleep() {
    if (resolveSleepCancel) {
      clearTimeout(timeout)
      resolveSleepCancel(undefined)
    }
  }

  function safeDelay(compute: () => number): number {
    try {
      const value = compute()
      if (!Number.isFinite(value)) {
        logger.error('Computed delay is not a finite number; using fallback', { value: String(value) })
        return FALLBACK_NEXT_DELAY_MS
      }
      return Math.max(0, value)
    } catch (error) {
      logger.error('Failed to compute next delay; using fallback', {
        error: isErrorWithMessage(error) ? error.message : String(error)
      })
      return FALLBACK_NEXT_DELAY_MS
    }
  }

  async function runJob() {
    const firstDelay = initialDelayMs ? safeDelay(initialDelayMs) : startupDelay
    await sleep(firstDelay)
    while (!shouldStop) {
      try {
        await job()
      } catch (error) {
        try {
          onError(error)
        } catch (onErrorError) {
          logger.error('onError callback threw', {
            error: isErrorWithMessage(onErrorError) ? onErrorError.message : String(onErrorError)
          })
        }
      }
      if (!repeat) {
        break
      }
      await sleep(safeDelay(nextDelayMs))
    }
    try {
      await onFinish()
    } catch (onFinishError) {
      logger.error('onFinish callback threw', {
        error: isErrorWithMessage(onFinishError) ? onFinishError.message : String(onFinishError)
      })
    }
    logger.info('[Stopped]')
  }

  async function start() {
    if (hasStarted) {
      logger.warn('start() called while the runner was already started; ignoring')
      return
    }
    hasStarted = true
    runJobPromise = runJob().catch(() => undefined)
  }

  async function stop() {
    logger.info('[Cancelling]')
    shouldStop = true
    cancelSleep()
    await runJobPromise
    logger.info('[Cancelled]')
  }

  return {
    [START_COMPONENT]: start,
    [STOP_COMPONENT]: stop
  }
}
