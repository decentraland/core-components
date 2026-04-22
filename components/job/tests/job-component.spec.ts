import { ILoggerComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { createLoggerMockedComponent } from '@dcl/core-commons'
import { createJobComponent } from '../src/component'
import { createScheduledRunner } from '../src/runner'
import { IJobComponent } from '../src/types'
import { InvalidCronExpressionError, InvalidStartupDelayError, WrongOnTimeError } from '../src/errors'

let logs: ILoggerComponent
let component: IJobComponent
let job: jest.Mock
let time: number
let componentFinished: Promise<void>
let onFinish: () => void
let errorLogMock: jest.Mock
const mockedSetTimeout = jest.spyOn(global, 'setTimeout')

beforeEach(() => {
  job = jest.fn()
  errorLogMock = jest.fn()
  logs = createLoggerMockedComponent({ error: errorLogMock })
  time = 1000
  let finish: () => void
  componentFinished = new Promise((resolve) => (finish = resolve))
  onFinish = () => finish()
  mockedSetTimeout.mockReset()
  mockedSetTimeout.mockImplementation((handler) => {
    ;(handler as any)()
    return 1 as any
  })
})

afterAll(() => {
  mockedSetTimeout.mockRestore()
})

describe('when creating the job component with a lower than 500ms onTime', () => {
  it('should throw an error', () => {
    expect(() => createJobComponent({ logs }, job, -1, { repeat: false, onFinish })).toThrow(WrongOnTimeError)
  })
})

describe('when creating the job component with a non-finite onTime', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Number.POSITIVE_INFINITY]
  ])('should throw a WrongOnTimeError for %s', (_label, invalid) => {
    expect(() => createJobComponent({ logs }, job, invalid, { repeat: false, onFinish })).toThrow(WrongOnTimeError)
  })
})

describe('when creating the job component with a negative startupDelay', () => {
  it('should throw an InvalidStartupDelayError', () => {
    expect(() =>
      createJobComponent({ logs }, job, time, { repeat: false, startupDelay: -10, onFinish })
    ).toThrow(InvalidStartupDelayError)
  })
})

describe('when creating the job component with a non-finite startupDelay', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Number.POSITIVE_INFINITY]
  ])('should throw an InvalidStartupDelayError for %s', (_label, invalid) => {
    expect(() =>
      createJobComponent({ logs }, job, time, { repeat: false, startupDelay: invalid, onFinish })
    ).toThrow(InvalidStartupDelayError)
  })
})

describe('when constructing custom error classes', () => {
  it('should set the name on WrongOnTimeError', () => {
    expect(new WrongOnTimeError(10).name).toBe('WrongOnTimeError')
  })

  it('should set the name on InvalidStartupDelayError', () => {
    expect(new InvalidStartupDelayError(-5).name).toBe('InvalidStartupDelayError')
  })

  it('should set the name on InvalidCronExpressionError', () => {
    expect(new InvalidCronExpressionError('bad', new Error('x')).name).toBe('InvalidCronExpressionError')
  })
})

describe('when starting a job', () => {
  describe('and the option to repeat the job is is set as false', () => {
    beforeEach(() => {
      component = createJobComponent({ logs }, job, time, { repeat: false, onFinish })
    })

    it('should run the job once and finish', async () => {
      await component[START_COMPONENT]?.({} as any)
      await componentFinished
      expect(job).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the start up time option is set', () => {
    beforeEach(() => {
      component = createJobComponent({ logs }, job, time, { startupDelay: 4000, repeat: false, onFinish })
    })

    it('should wait the defined time before running the job for the first time', async () => {
      await component[START_COMPONENT]?.({} as any)
      await componentFinished
      expect(mockedSetTimeout).toHaveBeenCalledWith(expect.anything(), 4000)
      expect(job).toHaveBeenCalled()
    })
  })

  describe('and the start up time option is not set', () => {
    beforeEach(() => {
      component = createJobComponent({ logs }, job, time, { repeat: false, onFinish })
    })

    it('should not wait before running the job for the first time', async () => {
      await component[START_COMPONENT]?.({} as any)
      await componentFinished
      expect(mockedSetTimeout).toHaveBeenCalledWith(expect.anything(), 0)
      expect(job).toHaveBeenCalled()
    })
  })

  describe('and the option to repeat the job is is set as true', () => {
    beforeEach(() => {
      component = createJobComponent({ logs }, job, time, { repeat: true, onFinish })
      job.mockResolvedValueOnce(undefined).mockImplementationOnce(() => {
        component[STOP_COMPONENT]?.()
      })
    })

    it('should repeat until the job on the given time until cancelled', async () => {
      await component[START_COMPONENT]?.({} as any)
      await componentFinished
      expect(mockedSetTimeout).toHaveBeenCalledWith(expect.anything(), 1000)
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
      component = createJobComponent({ logs }, job, time, { repeat: false, onError, onFinish })
    })

    it('should execute the given onError method', async () => {
      await component[START_COMPONENT]?.({} as any)
      await componentFinished
      expect(onError).toHaveBeenCalledWith(error)
    })
  })
})

describe('when stopping a started job', () => {
  let finishJobExecution: (value: unknown) => void
  let jobExecutingPromise: Promise<void>

  beforeEach(() => {
    let signalExecution: (value: void | PromiseLike<void>) => void
    component = createJobComponent({ logs }, job, time, { onFinish })
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

describe('when stopping after an earlier iteration rejected', () => {
  let onError: jest.Mock
  let iterationError: Error
  let iterationRejected: Promise<void>

  beforeEach(() => {
    iterationError = new Error('iteration blew up')
    let signalIterationRejected: () => void
    iterationRejected = new Promise<void>((r) => (signalIterationRejected = r))
    onError = jest.fn().mockImplementation(() => signalIterationRejected())

    // First setTimeout (startupDelay=0) fires sync; second (inter-iteration sleep) stays pending
    // so stop() runs while the prior iteration's rejection could still leak through the runner.
    mockedSetTimeout.mockReset()
    mockedSetTimeout
      .mockImplementationOnce((handler) => {
        ;(handler as any)()
        return 1 as any
      })
      .mockImplementationOnce(() => 2 as any)

    job.mockRejectedValueOnce(iterationError)
    component = createJobComponent({ logs }, job, time, {
      repeat: true,
      onError,
      onFinish
    })
  })

  it('should resolve stop() cleanly without re-throwing the prior rejection', async () => {
    await component[START_COMPONENT]?.({} as any)
    await iterationRejected
    await expect(component[STOP_COMPONENT]?.()).resolves.toBeUndefined()
    await componentFinished
    expect(onError).toHaveBeenCalledWith(iterationError)
  })
})

describe('when stopping a job whose onFinish is async and still pending', () => {
  let resolveOnFinish: () => void
  let onFinishStarted: Promise<void>

  beforeEach(() => {
    let signalOnFinishStarted: () => void
    onFinishStarted = new Promise<void>((r) => (signalOnFinishStarted = r))
    const onFinishPending = new Promise<void>((r) => (resolveOnFinish = r))
    component = createJobComponent({ logs }, job, time, {
      repeat: false,
      onFinish: async () => {
        signalOnFinishStarted()
        await onFinishPending
      }
    })
  })

  it('should not resolve stop() until onFinish has completed', async () => {
    await component[START_COMPONENT]?.({} as any)
    await onFinishStarted

    const stopping = component[STOP_COMPONENT]?.()
    let stopResolved = false
    stopping!.then(() => {
      stopResolved = true
    })

    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
    }
    expect(stopResolved).toBe(false)

    resolveOnFinish()
    await stopping
    expect(stopResolved).toBe(true)
  })
})

describe('when stopping the component during the startup sleep', () => {
  let mockedClearTimeout: jest.SpyInstance

  beforeEach(() => {
    mockedSetTimeout.mockReset()
    mockedSetTimeout.mockImplementationOnce(() => 1 as any)
    mockedClearTimeout = jest.spyOn(global, 'clearTimeout').mockImplementation(() => undefined)
    component = createJobComponent({ logs }, job, time, { startupDelay: 4000, onFinish })
  })

  afterEach(() => {
    mockedClearTimeout.mockRestore()
  })

  it('should clear the pending timeout and exit without running the job', async () => {
    await component[START_COMPONENT]?.({} as any)
    await component[STOP_COMPONENT]?.()
    await componentFinished
    expect(mockedClearTimeout).toHaveBeenCalledWith(1)
    expect(job).not.toHaveBeenCalled()
  })
})

describe('when the onError callback throws an Error', () => {
  let callbackError: Error

  beforeEach(() => {
    callbackError = new Error('onError blew up')
    job.mockRejectedValueOnce(new Error('job blew up'))
    component = createJobComponent({ logs }, job, time, {
      repeat: false,
      onError: () => {
        throw callbackError
      },
      onFinish
    })
  })

  it('should log the callback error message and continue to finish', async () => {
    await component[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(errorLogMock).toHaveBeenCalledWith('onError callback threw', {
      error: 'onError blew up'
    })
  })
})

describe('when the onError callback throws a non-Error value', () => {
  beforeEach(() => {
    job.mockRejectedValueOnce(new Error('job blew up'))
    component = createJobComponent({ logs }, job, time, {
      repeat: false,
      onError: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'string rejection'
      },
      onFinish
    })
  })

  it('should stringify the callback failure', async () => {
    await component[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(errorLogMock).toHaveBeenCalledWith('onError callback threw', {
      error: 'string rejection'
    })
  })
})

describe('when the onFinish callback throws an Error', () => {
  let callbackError: Error

  beforeEach(() => {
    callbackError = new Error('onFinish blew up')
    component = createJobComponent({ logs }, job, time, {
      repeat: false,
      onFinish: () => {
        onFinish()
        throw callbackError
      }
    })
  })

  it('should log the callback error message', async () => {
    await component[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(errorLogMock).toHaveBeenCalledWith('onFinish callback threw', {
      error: 'onFinish blew up'
    })
  })
})

describe('when the onFinish callback throws a non-Error value', () => {
  beforeEach(() => {
    component = createJobComponent({ logs }, job, time, {
      repeat: false,
      onFinish: () => {
        onFinish()
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'finish string rejection'
      }
    })
  })

  it('should stringify the callback failure', async () => {
    await component[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(errorLogMock).toHaveBeenCalledWith('onFinish callback threw', {
      error: 'finish string rejection'
    })
  })
})

describe('when options is an empty object', () => {
  let infoLogMock: jest.Mock
  let stoppedPromise: Promise<void>

  beforeEach(() => {
    let stoppedResolve: () => void
    stoppedPromise = new Promise<void>((r) => (stoppedResolve = r))
    infoLogMock = jest.fn().mockImplementation((msg: string) => {
      if (msg === '[Stopped]') stoppedResolve()
    })
    logs = createLoggerMockedComponent({ error: errorLogMock, info: infoLogMock })
    job.mockRejectedValueOnce(new Error('silent'))
    component = createJobComponent({ logs }, job, time, { repeat: false })
  })

  it('should apply default no-op onError and onFinish callbacks', async () => {
    await component[START_COMPONENT]?.({} as any)
    await stoppedPromise
    expect(job).toHaveBeenCalledTimes(1)
  })
})

describe('when start is called while the runner is already started', () => {
  let warnLogMock: jest.Mock

  beforeEach(() => {
    warnLogMock = jest.fn()
    logs = createLoggerMockedComponent({ error: errorLogMock, warn: warnLogMock })
    component = createJobComponent({ logs }, job, time, { repeat: false, onFinish })
  })

  it('should warn and ignore the second start call', async () => {
    await component[START_COMPONENT]?.({} as any)
    await component[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(warnLogMock).toHaveBeenCalledWith(
      'start() called while the runner was already started; ignoring'
    )
    expect(job).toHaveBeenCalledTimes(1)
  })
})

describe('when nextDelayMs returns a non-finite number', () => {
  let nextDelayMs: jest.Mock
  let runner: IJobComponent

  beforeEach(() => {
    nextDelayMs = jest
      .fn()
      .mockReturnValueOnce(NaN)
      .mockImplementation(() => {
        runner[STOP_COMPONENT]?.()
        return 1000
      })
    runner = createScheduledRunner({
      logs,
      job: jest.fn(),
      nextDelayMs,
      options: { repeat: true, onFinish }
    })
  })

  it('should log and fall back to the 60s delay', async () => {
    await runner[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(errorLogMock).toHaveBeenCalledWith('Computed delay is not a finite number; using fallback', {
      value: 'NaN'
    })
    expect(mockedSetTimeout).toHaveBeenCalledWith(expect.anything(), 60_000)
  })
})

describe('when nextDelayMs returns Infinity', () => {
  let nextDelayMs: jest.Mock
  let runner: IJobComponent

  beforeEach(() => {
    nextDelayMs = jest
      .fn()
      .mockReturnValueOnce(Infinity)
      .mockImplementation(() => {
        runner[STOP_COMPONENT]?.()
        return 1000
      })
    runner = createScheduledRunner({
      logs,
      job: jest.fn(),
      nextDelayMs,
      options: { repeat: true, onFinish }
    })
  })

  it('should log and fall back to the 60s delay', async () => {
    await runner[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(errorLogMock).toHaveBeenCalledWith('Computed delay is not a finite number; using fallback', {
      value: 'Infinity'
    })
    expect(mockedSetTimeout).toHaveBeenCalledWith(expect.anything(), 60_000)
  })
})

describe('when nextDelayMs throws an Error between iterations', () => {
  let nextDelayMs: jest.Mock
  let runner: IJobComponent

  beforeEach(() => {
    nextDelayMs = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('delay computation failed')
      })
      .mockImplementation(() => {
        runner[STOP_COMPONENT]?.()
        return 1000
      })
    runner = createScheduledRunner({
      logs,
      job: jest.fn(),
      nextDelayMs,
      options: { repeat: true, onFinish }
    })
  })

  it('should log the failure and fall back to a 60s delay instead of crashing the runner', async () => {
    await runner[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(errorLogMock).toHaveBeenCalledWith(
      'Failed to compute next delay; using fallback',
      { error: 'delay computation failed' }
    )
    expect(mockedSetTimeout).toHaveBeenCalledWith(expect.anything(), 60_000)
  })
})

describe('when nextDelayMs throws a non-Error value between iterations', () => {
  let nextDelayMs: jest.Mock
  let runner: IJobComponent

  beforeEach(() => {
    nextDelayMs = jest
      .fn()
      .mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'delay string rejection'
      })
      .mockImplementation(() => {
        runner[STOP_COMPONENT]?.()
        return 1000
      })
    runner = createScheduledRunner({
      logs,
      job: jest.fn(),
      nextDelayMs,
      options: { repeat: true, onFinish }
    })
  })

  it('should stringify the non-Error cause in the fallback log', async () => {
    await runner[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(errorLogMock).toHaveBeenCalledWith(
      'Failed to compute next delay; using fallback',
      { error: 'delay string rejection' }
    )
  })
})

describe('when stop() is called while the job is still executing', () => {
  let finishJobExecution: (value: unknown) => void
  let jobRunning: Promise<void>

  beforeEach(() => {
    mockedSetTimeout.mockReset()
    mockedSetTimeout
      .mockImplementationOnce((handler) => {
        ;(handler as any)()
        return 1 as any
      })
      .mockImplementation(() => 2 as any)

    let signalRunning: () => void
    jobRunning = new Promise<void>((r) => (signalRunning = r))
    job.mockImplementationOnce(() => {
      signalRunning()
      return new Promise((resolve) => {
        finishJobExecution = resolve
      })
    })
    component = createJobComponent({ logs }, job, time, { repeat: true, onFinish })
  })

  it('should break out of the loop before scheduling the inter-iteration sleep', async () => {
    await component[START_COMPONENT]?.({} as any)
    await jobRunning

    const stopping = component[STOP_COMPONENT]?.()
    finishJobExecution(undefined)
    await Promise.all([stopping, componentFinished])

    expect(job).toHaveBeenCalledTimes(1)
    expect(mockedSetTimeout).toHaveBeenCalledTimes(1)
  })
})

describe('when nextDelayMs returns a value larger than the 32-bit setTimeout limit', () => {
  let nextDelayMs: jest.Mock
  let runner: IJobComponent

  beforeEach(() => {
    nextDelayMs = jest
      .fn()
      .mockReturnValueOnce(30 * 24 * 60 * 60 * 1000)
      .mockImplementation(() => {
        runner[STOP_COMPONENT]?.()
        return 1000
      })
    runner = createScheduledRunner({
      logs,
      job: jest.fn(),
      nextDelayMs,
      options: { repeat: true, onFinish }
    })
  })

  it('should clamp the delay to the 32-bit setTimeout max', async () => {
    await runner[START_COMPONENT]?.({} as any)
    await componentFinished
    expect(mockedSetTimeout).toHaveBeenCalledWith(expect.anything(), 2_147_483_647)
  })
})

describe('when runJob rejects unexpectedly after onFinish', () => {
  let infoLogMock: jest.Mock

  beforeEach(() => {
    infoLogMock = jest.fn().mockImplementation((msg: string) => {
      if (msg === '[Stopped]') {
        throw new Error('logger exploded')
      }
    })
    logs = createLoggerMockedComponent({ error: errorLogMock, info: infoLogMock })
    component = createJobComponent({ logs }, job, time, {
      repeat: false,
      onFinish: () => undefined
    })
  })

  it('should log the failure from the run loop instead of swallowing it', async () => {
    await component[START_COMPONENT]?.({} as any)
    await component[STOP_COMPONENT]?.()

    expect(errorLogMock).toHaveBeenCalledWith('run loop terminated unexpectedly', {
      error: 'logger exploded'
    })
  })
})

describe('when runJob rejects with a non-Error value', () => {
  let infoLogMock: jest.Mock

  beforeEach(() => {
    infoLogMock = jest.fn().mockImplementation((msg: string) => {
      if (msg === '[Stopped]') {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'non-error rejection'
      }
    })
    logs = createLoggerMockedComponent({ error: errorLogMock, info: infoLogMock })
    component = createJobComponent({ logs }, job, time, {
      repeat: false,
      onFinish: () => undefined
    })
  })

  it('should stringify the rejection in the run-loop failure log', async () => {
    await component[START_COMPONENT]?.({} as any)
    await component[STOP_COMPONENT]?.()

    expect(errorLogMock).toHaveBeenCalledWith('run loop terminated unexpectedly', {
      error: 'non-error rejection'
    })
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
    logs = createLoggerMockedComponent({ error: errorLogMock, info: infoLogMock })
    component = createJobComponent({ logs }, job, time)
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
