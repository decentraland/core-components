import { START_COMPONENT, STOP_COMPONENT, ILoggerComponent } from '@well-known-components/interfaces'
import { createLoggerMockedComponent } from '@dcl/core-commons'
import { createCronJobComponent } from '../src/cron-component'
import { IJobComponent } from '../src/types'
import { InvalidCronExpressionError } from '../src/errors'

let logs: ILoggerComponent
let component: IJobComponent
let job: jest.Mock
let componentFinished: Promise<void>
let onFinish: () => void
let mockedSetTimeout: jest.SpyInstance

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] })
  jest.setSystemTime(new Date('2026-01-01T00:00:30Z'))

  mockedSetTimeout = jest.spyOn(global, 'setTimeout')
  mockedSetTimeout.mockImplementation((handler) => {
    ;(handler as any)()
    return 1 as any
  })

  job = jest.fn()
  logs = createLoggerMockedComponent()
  let finish: () => void
  componentFinished = new Promise((resolve) => (finish = resolve))
  onFinish = () => finish()
})

afterEach(() => {
  mockedSetTimeout.mockRestore()
  jest.useRealTimers()
})

describe('when creating the cron job component with an invalid cron expression', () => {
  it('should throw an InvalidCronExpressionError', () => {
    expect(() =>
      createCronJobComponent({ logs }, job, { cron: 'not-a-cron' }, { repeat: false, onFinish })
    ).toThrow(InvalidCronExpressionError)
  })
})

describe('when InvalidCronExpressionError is constructed with a non-Error cause', () => {
  it('should include the stringified cause in the message and preserve the raw cause', () => {
    const rawCause = 'string reason'
    const error = new InvalidCronExpressionError('bad-expr', rawCause)
    expect(error.message).toContain('bad-expr')
    expect(error.message).toContain('string reason')
    expect(error.cause).toBe(rawCause)
  })
})

describe('when InvalidCronExpressionError is constructed with an Error cause', () => {
  it('should preserve the raw Error as the cause property', () => {
    const rawCause = new Error('parser exploded')
    const error = new InvalidCronExpressionError('bad-expr', rawCause)
    expect(error.cause).toBe(rawCause)
  })
})

describe('when the schedule sets skipFirstRun together with a startupDelay', () => {
  let warnLogMock: jest.Mock

  beforeEach(() => {
    warnLogMock = jest.fn()
    logs = createLoggerMockedComponent({ warn: warnLogMock })
    createCronJobComponent(
      { logs },
      job,
      { cron: '* * * * *', skipFirstRun: true },
      { startupDelay: 5000, repeat: false, onFinish }
    )
  })

  it('should warn that startupDelay is ignored', () => {
    expect(warnLogMock).toHaveBeenCalledWith(
      'Both skipFirstRun and startupDelay are set; startupDelay is ignored in favor of the next cron match'
    )
  })
})

describe('when the schedule has skipFirstRun set to true', () => {
  beforeEach(() => {
    component = createCronJobComponent(
      { logs },
      job,
      { cron: '* * * * *', skipFirstRun: true },
      { repeat: false, onFinish }
    )
  })

  it('should sleep until the next cron fire time before the first run', async () => {
    await component[START_COMPONENT]?.({} as any)
    await componentFinished
    // Fixed time 2026-01-01T00:00:30Z + cron '* * * * *' → next fire at 00:01:00Z → 30000 ms.
    expect(mockedSetTimeout).toHaveBeenCalledWith(expect.anything(), 30000)
    expect(job).toHaveBeenCalledTimes(1)
  })
})

describe('when the schedule includes a timezone', () => {
  beforeEach(() => {
    component = createCronJobComponent(
      { logs },
      job,
      { cron: '0 3 * * *', timezone: 'America/New_York' },
      { repeat: false, onFinish }
    )
  })

  it('should accept the timezone and run the job', async () => {
    await component[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(job).toHaveBeenCalledTimes(1)
  })
})

describe('when the options argument is omitted entirely', () => {
  let infoLogMock: jest.Mock
  let stoppedPromise: Promise<void>

  beforeEach(() => {
    let stoppedResolve: () => void
    stoppedPromise = new Promise<void>((r) => (stoppedResolve = r))
    infoLogMock = jest.fn().mockImplementation((msg: string) => {
      if (msg === '[Stopped]') stoppedResolve()
    })
    logs = createLoggerMockedComponent({ info: infoLogMock })
    component = createCronJobComponent({ logs }, job, { cron: '* * * * *' })
    job.mockImplementationOnce(() => {
      component[STOP_COMPONENT]?.()
    })
  })

  it('should fall back to the default options object and run the job', async () => {
    await component[START_COMPONENT]?.({} as any)
    await stoppedPromise
    expect(job).toHaveBeenCalled()
  })
})

describe('when starting a cron job', () => {
  describe('and the option to repeat the job is set as false', () => {
    beforeEach(() => {
      component = createCronJobComponent({ logs }, job, { cron: '* * * * *' }, { repeat: false, onFinish })
    })

    it('should run the job once and finish', async () => {
      await component[START_COMPONENT]?.({} as any)
      await componentFinished
      expect(job).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the startup delay option is set', () => {
    beforeEach(() => {
      component = createCronJobComponent(
        { logs },
        job,
        { cron: '* * * * *' },
        { startupDelay: 4000, repeat: false, onFinish }
      )
    })

    it('should wait the defined time before running the job for the first time', async () => {
      await component[START_COMPONENT]?.({} as any)
      await componentFinished
      expect(mockedSetTimeout).toHaveBeenCalledWith(expect.anything(), 4000)
      expect(job).toHaveBeenCalled()
    })
  })

  describe('and the option to repeat the job is set as true', () => {
    beforeEach(() => {
      component = createCronJobComponent({ logs }, job, { cron: '* * * * *' }, { repeat: true, onFinish })
      job.mockResolvedValueOnce(undefined).mockImplementationOnce(() => {
        component[STOP_COMPONENT]?.()
      })
    })

    it('should sleep until the next cron fire time between iterations', async () => {
      await component[START_COMPONENT]?.({} as any)
      await componentFinished
      // Fixed time 2026-01-01T00:00:30Z + cron '* * * * *' → next fire at 00:01:00Z → delay 30000 ms.
      expect(mockedSetTimeout).toHaveBeenCalledWith(expect.anything(), 30000)
      expect(job).toHaveBeenCalledTimes(2)
    })
  })

  describe("and there's an error when executing the job", () => {
    let onError: jest.Mock
    let error: Error

    beforeEach(() => {
      onError = jest.fn()
      error = new Error('An error occurred')
      job.mockRejectedValueOnce(error)
      component = createCronJobComponent(
        { logs },
        job,
        { cron: '* * * * *' },
        { repeat: false, onError, onFinish }
      )
    })

    it('should execute the given onError method', async () => {
      await component[START_COMPONENT]?.({} as any)
      await componentFinished
      expect(onError).toHaveBeenCalledWith(error)
    })
  })
})

describe('when stopping a started cron job', () => {
  let finishJobExecution: (value: unknown) => void
  let jobExecutingPromise: Promise<void>

  beforeEach(() => {
    let signalExecution: (value: void | PromiseLike<void>) => void
    component = createCronJobComponent({ logs }, job, { cron: '* * * * *' }, { onFinish })
    jobExecutingPromise = new Promise((resolve) => (signalExecution = resolve))
    job
      .mockImplementationOnce(() => {
        signalExecution()
        return new Promise((resolve) => {
          finishJobExecution = resolve
        })
      })
      .mockRejectedValueOnce("It shouldn't execute the job twice")
  })

  it('should wait until the job has completed and not run any more jobs', async () => {
    await component[START_COMPONENT]?.({} as any)
    await jobExecutingPromise
    const promiseOfStoppingTheJob = component[STOP_COMPONENT]?.()
    finishJobExecution(undefined)
    await Promise.all([promiseOfStoppingTheJob, componentFinished])
    expect(job).toHaveBeenCalledTimes(1)
  })
})
