import { START_COMPONENT, STOP_COMPONENT, ILoggerComponent } from '@well-known-components/interfaces'
import { IJobComponent, JobOptions } from './types'
import { WrongOnTimeError } from './errors'

export function createJobComponent(
  components: Pick<{ logs: ILoggerComponent }, 'logs'>,
  /** The function to execute as a job. Admits asynchronous functions. */
  job: () => any,
  /** The amount of time to wait between jobs */
  onTime: number,
  { repeat = true, startupDelay = 0, onError = () => undefined, onFinish = () => undefined }: JobOptions = {
    repeat: true,
    startupDelay: 0,
    onError: () => undefined,
    onFinish: () => undefined
  }
): IJobComponent {
  const { logs } = components
  let runningJob: Promise<any> = Promise.resolve()
  let shouldStop: boolean = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let resolveSleepCancel: ((value: unknown) => void) | undefined
  const logger = logs.getLogger('job')

  if (onTime < 500) {
    throw new WrongOnTimeError(onTime)
  }

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
    if (timeout && resolveSleepCancel) {
      clearTimeout(timeout)
      resolveSleepCancel(undefined)
    }
  }

  async function start() {
    // Start the job but don't wait for it
    runJob().catch(() => {
      // Do nothing
    })
  }

  async function runJob() {
    await sleep(startupDelay)
    while (!shouldStop) {
      try {
        runningJob = job()
        await runningJob
      } catch (error) {
        onError(error)
      }
      if (!repeat) {
        break
      }
      await sleep(onTime)
    }
    await onFinish()
    logger.info('[Stopped]')
  }

  async function stop() {
    logger.info('[Cancelling]')
    shouldStop = true
    cancelSleep()
    await runningJob
    logger.info('[Cancelled]')
  }

  return {
    [START_COMPONENT]: start,
    [STOP_COMPONENT]: stop
  }
}
