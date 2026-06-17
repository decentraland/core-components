import { ILoggerComponent } from '@well-known-components/interfaces'
import { InvalidMaxIntervalError } from '../src/errors'
import { createExponentialBackoffRetry, ExponentialBackoffRetryComponent } from '../src/retry'

describe('when running an exponential-backoff retry task', () => {
  let logger: ILoggerComponent.ILogger

  beforeEach(() => {
    logger = { log: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and maxInterval is negative', () => {
    it('should throw an InvalidMaxIntervalError', () => {
      expect(() =>
        createExponentialBackoffRetry(logger, { action: async () => {}, retryTime: 1, maxInterval: -1 })
      ).toThrow(InvalidMaxIntervalError)
    })
  })

  describe('and exitOnSuccess is set and the action succeeds', () => {
    let action: jest.Mock
    let retry: ExponentialBackoffRetryComponent

    beforeEach(async () => {
      action = jest.fn().mockResolvedValue(undefined)
      retry = createExponentialBackoffRetry(logger, { action, retryTime: 1, exitOnSuccess: true })
      await retry.start()
    })

    it('should run the action exactly once', () => {
      expect(action).toHaveBeenCalledTimes(1)
    })

    it('should report itself as stopped after finishing', () => {
      expect(retry.isStopped()).toBe(true)
    })
  })

  describe('and the action fails once before succeeding', () => {
    let action: jest.Mock
    let retry: ExponentialBackoffRetryComponent

    beforeEach(async () => {
      action = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
      retry = createExponentialBackoffRetry(logger, { action, retryTime: 1, exitOnSuccess: true })
      await retry.start()
    })

    it('should keep retrying until the action succeeds', () => {
      expect(action).toHaveBeenCalledTimes(2)
    })

    it('should count each attempt', () => {
      expect(retry.getRetryCount()).toBe(2)
    })
  })

  describe('and stop is called while it is waiting to retry', () => {
    let action: jest.Mock
    let retry: ExponentialBackoffRetryComponent

    beforeEach(async () => {
      action = jest.fn().mockRejectedValue(new Error('always fails'))
      retry = createExponentialBackoffRetry(logger, { action, retryTime: 10_000 })
      const startPromise = retry.start()
      await new Promise((resolve) => setTimeout(resolve, 20))
      await retry.stop()
      await startPromise
    })

    it('should report itself as stopped', () => {
      expect(retry.isStopped()).toBe(true)
    })
  })
})
