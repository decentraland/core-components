import { ILoggerComponent } from '@well-known-components/interfaces'
import { InvalidMaxIntervalError } from './errors'
import { ITaskWithLifecycle } from './types'

export type ExponentialBackoffRetryComponent = ITaskWithLifecycle & {
  getRetryCount(): number
  isStopped(): boolean
}

export type ExponentialBackoffRetryOptions = {
  retryTime: number
  /** @default 1.1 */
  retryTimeExponent?: number
  action: () => Promise<void>
  /** Maximum backoff interval in milliseconds. @default 86_400_000 one day */
  maxInterval?: number
  exitOnSuccess?: boolean
}

/**
 * Creates a task that executes long-living actions over and over until stopped, with configurable
 * exponential backoff between attempts.
 */
export function createExponentialBackoffRetry(
  logs: ILoggerComponent.ILogger,
  options: ExponentialBackoffRetryOptions
): ExponentialBackoffRetryComponent {
  let started: boolean = false

  if (options.maxInterval && options.maxInterval < 0) throw new InvalidMaxIntervalError()

  const exitOnSuccess = options.exitOnSuccess || false

  let reconnectionCount = 0

  // Allows stop() to interrupt an in-flight retry sleep instead of waiting out the full (possibly
  // multi-day) interval before the loop notices it was stopped.
  let cancelCurrentSleep: (() => void) | undefined

  function interruptibleSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (ms <= 0) {
        resolve()
        return
      }
      const timeout = setTimeout(() => {
        cancelCurrentSleep = undefined
        resolve()
      }, ms)
      cancelCurrentSleep = () => {
        clearTimeout(timeout)
        cancelCurrentSleep = undefined
        resolve()
      }
    })
  }

  async function loop() {
    let reconnectionTime = options.retryTime

    while (true) {
      logs.info('Starting...')
      reconnectionCount++

      try {
        await options.action()
        if (exitOnSuccess) {
          logs.info('Breaking iteration. Action ended successfully')
          return
        }
      } catch (e: any) {
        logs.error(e)
        reconnectionTime = reconnectionTime * (options.retryTimeExponent ?? 1.1)
        if (options.maxInterval) {
          reconnectionTime = Math.min(reconnectionTime, options.maxInterval)
        }
      }

      if (!started) {
        logs.info('Breaking iteration, started == false')
        return
      }

      if (!options.retryTime) {
        logs.info('Not iterating due to missing or zero options.retryTime')
        return
      }

      if (options.maxInterval) {
        reconnectionTime = Math.min(reconnectionTime, options.maxInterval)
      } else {
        reconnectionTime = Math.min(reconnectionTime, 86_400_000 /* one day */)
      }

      logs.info('Retrying in ' + reconnectionTime.toFixed(1) + 'ms')
      await interruptibleSleep(reconnectionTime)
    }
  }

  return {
    getRetryCount() {
      return reconnectionCount
    },
    isStopped() {
      return !started
    },
    async start() {
      if (started === true) return
      started = true
      try {
        await loop()
      } finally {
        // Reset so isStopped() is accurate once the loop exits (e.g. exitOnSuccess) and the
        // task can be started again.
        started = false
      }
    },
    async stop() {
      started = false
      if (cancelCurrentSleep) {
        cancelCurrentSleep()
      }
    }
  }
}
