import { ILoggerComponent } from '@well-known-components/interfaces'
import {
  createReconnectionManager,
  getBackoffDelay,
  isConnectionError,
  isNotSentError,
  ReconnectionManager,
  ResolvedReconnectionOptions
} from '../src/reconnection'
import { DatabaseError } from 'pg'
import { IMetricsComponent } from '../src/types'
import { DatabaseUnavailableError } from '../src/errors'

function createMockLogs(): ILoggerComponent {
  return {
    getLogger: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn()
    })
  }
}

function createMockMetrics(): IMetricsComponent {
  return {
    startTimer: jest.fn().mockReturnValue({ end: jest.fn() }),
    observe: jest.fn(),
    increment: jest.fn(),
    decrement: jest.fn(),
    reset: jest.fn(),
    resetAll: jest.fn(),
    getValue: jest.fn()
  }
}

function createErrorWithCode(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

// Real timers with millisecond delays: `timers/promises` is not reliably driven by Jest's fake
// timers, and the values are small enough that the suite stays fast.
const FAST_OPTIONS: ResolvedReconnectionOptions = {
  enabled: true,
  maxRetries: 3,
  startMaxRetries: 3,
  initialDelayInMilliseconds: 2,
  maxDelayInMilliseconds: 50,
  backoffFactor: 2,
  probeTimeoutInMilliseconds: 200
}

function waitUntil(condition: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (condition() ? resolve() : global.setTimeout(check, 5))
    check()
  })
}

describe('when importing the package entry point', () => {
  let entryPoint: Record<string, unknown>

  beforeEach(() => {
    entryPoint = require('../src')
  })

  it('should expose the component factory', () => {
    expect(entryPoint.createPgComponent).toBeDefined()
  })

  it('should expose the metric declarations', () => {
    expect(entryPoint.metricDeclarations).toBeDefined()
  })

  it('should expose the connection error classifier for callers that handle outages themselves', () => {
    expect(entryPoint.isConnectionError).toBeDefined()
  })

  it('should not publish the internal reconnection manager', () => {
    expect(entryPoint.createReconnectionManager).toBeUndefined()
  })

  it('should not publish the backoff helper or the default constants, which have no consumer', () => {
    expect(entryPoint.getBackoffDelay).toBeUndefined()
    expect(entryPoint.DEFAULT_RECONNECTION_OPTIONS).toBeUndefined()
  })
})

describe('when checking whether an error is a connection error', () => {
  describe('and the error carries a socket-level code', () => {
    let error: Error

    beforeEach(() => {
      error = createErrorWithCode('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED')
    })

    it('should classify it as a connection error', () => {
      expect(isConnectionError(error)).toBe(true)
    })
  })

  describe('and the error carries a class 08 SQLSTATE', () => {
    let error: Error

    beforeEach(() => {
      error = createErrorWithCode('connection failure', '08006')
    })

    it('should classify it as a connection error', () => {
      expect(isConnectionError(error)).toBe(true)
    })
  })

  describe('and the error carries the admin shutdown SQLSTATE', () => {
    let error: Error

    beforeEach(() => {
      error = createErrorWithCode('terminating connection due to administrator command', '57P01')
    })

    it('should classify it as a connection error', () => {
      expect(isConnectionError(error)).toBe(true)
    })
  })

  describe('and the error only reports a terminated connection in its message', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('Connection terminated unexpectedly')
    })

    it('should classify it as a connection error', () => {
      expect(isConnectionError(error)).toBe(true)
    })
  })

  describe('and the error is pg-pool timing out a real connection attempt', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('Connection terminated due to connection timeout')
    })

    it('should classify it as a connection error', () => {
      expect(isConnectionError(error)).toBe(true)
    })
  })

  describe('and the error is pg-pool timing out the wait for a free client', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('timeout exceeded when trying to connect')
    })

    it('should not classify it as a connection error, since it means the pool is saturated', () => {
      expect(isConnectionError(error)).toBe(false)
    })
  })

  describe('and the error is a syntax error reported by the server', () => {
    let error: Error

    beforeEach(() => {
      error = createErrorWithCode('syntax error at or near "SELCT"', '42601')
    })

    it('should not classify it as a connection error', () => {
      expect(isConnectionError(error)).toBe(false)
    })
  })

  describe('and the error reports that the pool was already ended', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('Cannot use a pool after calling end on the pool')
    })

    it('should not classify it as a connection error, since reconnecting can never fix it', () => {
      expect(isConnectionError(error)).toBe(false)
    })
  })

  describe('and the error reports that the pool was ended more than once', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('Called end on pool more than once')
    })

    it('should not classify it as a connection error, since reconnecting can never fix it', () => {
      expect(isConnectionError(error)).toBe(false)
    })
  })

  describe('and the server raised an error whose text mimics a driver disconnection', () => {
    let error: DatabaseError

    beforeEach(() => {
      // What `RAISE EXCEPTION 'Client has encountered a connection error and is not queryable'`
      // arrives as: a server error with a SQLSTATE and attacker-chosen text.
      error = new DatabaseError('Client has encountered a connection error and is not queryable', 60, 'error')
      error.severity = 'ERROR'
      error.code = 'P0001'
    })

    it('should not classify it as a connection error, since the SQLSTATE says otherwise', () => {
      expect(isConnectionError(error)).toBe(false)
    })

    it('should not take it as proof the statement never reached the server', () => {
      expect(isNotSentError(error)).toBe(false)
    })
  })

  describe('and the server reports a genuine connection-class SQLSTATE', () => {
    let error: DatabaseError

    beforeEach(() => {
      error = new DatabaseError('terminating connection due to administrator command', 60, 'error')
      error.severity = 'FATAL'
      error.code = '57P01'
    })

    it('should classify it as a connection error by its code', () => {
      expect(isConnectionError(error)).toBe(true)
    })
  })

  describe('and the error is a bare string rather than an Error', () => {
    it('should still classify it by its text', () => {
      expect(isConnectionError('Connection terminated unexpectedly')).toBe(true)
    })
  })

  describe('and the error is null', () => {
    it('should not classify it as a connection error', () => {
      expect(isConnectionError(null)).toBe(false)
    })
  })
})

describe('when checking whether an error proves the statement was never sent', () => {
  describe('and the client had already encountered a connection error', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('Client has encountered a connection error and is not queryable')
    })

    it('should classify it as a never-sent error', () => {
      expect(isNotSentError(error)).toBe(true)
    })
  })

  describe('and the connection dropped while the statement was in flight', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('Connection terminated unexpectedly')
    })

    it('should not classify it as a never-sent error', () => {
      expect(isNotSentError(error)).toBe(false)
    })
  })
})

describe('when computing the backoff delay', () => {
  let options: Pick<
    ResolvedReconnectionOptions,
    'initialDelayInMilliseconds' | 'maxDelayInMilliseconds' | 'backoffFactor'
  >

  beforeEach(() => {
    options = { initialDelayInMilliseconds: 100, maxDelayInMilliseconds: 1000, backoffFactor: 2 }
  })

  describe('and it is the first attempt', () => {
    let delay: number

    beforeEach(() => {
      delay = getBackoffDelay(0, options)
    })

    it('should stay within the jittered half of the initial delay', () => {
      expect(delay).toBeGreaterThanOrEqual(50)
      expect(delay).toBeLessThanOrEqual(100)
    })
  })

  describe('and it is the third attempt', () => {
    let delay: number

    beforeEach(() => {
      delay = getBackoffDelay(2, options)
    })

    it('should grow exponentially within the jittered half of the delay', () => {
      expect(delay).toBeGreaterThanOrEqual(200)
      expect(delay).toBeLessThanOrEqual(400)
    })
  })

  describe('and the exponential delay exceeds the configured maximum', () => {
    let delay: number

    beforeEach(() => {
      delay = getBackoffDelay(20, options)
    })

    it('should cap the delay at the configured maximum', () => {
      expect(delay).toBeLessThanOrEqual(1000)
    })
  })
})

describe('when running an operation through the reconnection manager', () => {
  let logs: ILoggerComponent
  let probeConnection: jest.Mock<Promise<void>, []>
  let manager: ReconnectionManager

  afterEach(() => {
    manager.stop()
  })

  describe('and the operation succeeds on the first attempt', () => {
    let operation: jest.Mock<Promise<string>, []>
    let result: string

    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest.fn().mockResolvedValue('ok')
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
      result = await manager.run('test', operation)
    })

    it('should return the result of the operation', () => {
      expect(result).toBe('ok')
    })

    it('should report the connection as established', () => {
      expect(manager.getStatus().connected).toBe(true)
    })
  })

  describe('and the operation fails while acquiring the connection before succeeding', () => {
    let operation: jest.Mock<Promise<string>, []>
    let result: string

    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest
        .fn()
        .mockRejectedValueOnce(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
        .mockResolvedValueOnce('ok')
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
      result = await manager.run('test', operation)
    })

    it('should retry the operation and return its result', () => {
      expect(result).toBe('ok')
    })

    it('should have called the operation twice', () => {
      expect(operation).toHaveBeenCalledTimes(2)
    })
  })

  describe('and the operation keeps failing with a connection error', () => {
    let operation: jest.Mock<Promise<string>, []>

    beforeEach(() => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      operation = jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
    })

    it('should reject as unavailable after exhausting the retries, keeping the driver error as the cause', async () => {
      const error = await manager.run('test', operation).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(DatabaseUnavailableError)
      expect((error as DatabaseUnavailableError).cause).toMatchObject({ message: 'connect ECONNREFUSED' })
    })

    it('should keep the driver detail out of the public message', async () => {
      await expect(manager.run('test', operation)).rejects.toThrow('The database is unreachable')
      await expect(manager.run('test', operation)).rejects.not.toThrow('ECONNREFUSED')
    })

    it('should attempt the operation once and then wait on the shared probes instead of retrying it', async () => {
      await expect(manager.run('test', operation)).rejects.toThrow()
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should reject with a typed unavailability error that the classifier recognises', async () => {
      const error = await manager.run('test', operation).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(DatabaseUnavailableError)
      expect(isConnectionError(error)).toBe(true)
    })
  })

  describe('and the database is already known to be down when the operation arrives', () => {
    let operation: jest.Mock<Promise<string>, []>
    let result: string

    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest
        .fn()
        .mockRejectedValueOnce(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
        .mockRejectedValueOnce(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
        .mockResolvedValue(undefined)
      operation = jest.fn().mockResolvedValue('ok')
      manager = createReconnectionManager({ logs }, { ...FAST_OPTIONS, maxRetries: 5 }, probeConnection)
      manager.notifySuccess()
      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      result = await manager.run('test', operation)
    })

    it('should not invoke the operation until a probe has succeeded', () => {
      // Two probes failed before the third succeeded; the operation ran only after that verdict.
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should return the result once the database is back', () => {
      expect(result).toBe('ok')
    })
  })

  describe('and many operations arrive during the same outage', () => {
    let operation: jest.Mock<Promise<string>, []>
    let results: string[]

    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest
        .fn()
        .mockRejectedValueOnce(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
        .mockResolvedValue(undefined)
      operation = jest.fn().mockResolvedValue('ok')
      manager = createReconnectionManager({ logs }, { ...FAST_OPTIONS, maxRetries: 5 }, probeConnection)
      manager.notifySuccess()
      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      results = await Promise.all(Array.from({ length: 25 }, () => manager.run('test', operation)))
    })

    it('should serve every operation once the database is back', () => {
      expect(results).toEqual(Array.from({ length: 25 }, () => 'ok'))
    })

    it('should have probed the database a handful of times rather than once per caller', () => {
      expect(probeConnection.mock.calls.length).toBeLessThan(5)
    })
  })

  describe('and the failure was a dead pooled client rather than an unreachable database', () => {
    let operation: jest.Mock<Promise<string>, [{ markStatementSent(): void }]>
    let result: string

    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest
        .fn()
        .mockImplementationOnce(async (context: { markStatementSent(): void }) => {
          context.markStatementSent()
          throw new Error('Client has encountered a connection error and is not queryable')
        })
        .mockResolvedValueOnce('ok')
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
      manager.notifySuccess()
      result = await manager.run('test', operation)
    })

    it('should retry on a fresh client straight away and succeed', () => {
      expect(result).toBe('ok')
    })

    it('should not report an outage, since the database itself was never unreachable', () => {
      expect(manager.getStatus().disconnections).toBe(0)
    })

    it('should not have started probing', () => {
      expect(probeConnection).not.toHaveBeenCalled()
    })
  })

  describe('and the operation fails with an error that is not a connection error', () => {
    let operation: jest.Mock<Promise<string>, []>

    beforeEach(() => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest.fn().mockRejectedValue(createErrorWithCode('syntax error at or near "SELCT"', '42601'))
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
    })

    it('should reject with the original error without retrying', async () => {
      await expect(manager.run('test', operation)).rejects.toThrow('syntax error')
      expect(operation).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the connection drops after the statement was sent', () => {
    let operation: jest.Mock<Promise<string>, [{ markStatementSent(): void }]>

    beforeEach(() => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest.fn().mockImplementation(async (context: { markStatementSent(): void }) => {
        context.markStatementSent()
        throw new Error('Connection terminated unexpectedly')
      })
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
    })

    it('should reject without retrying, since the statement may already have been applied', async () => {
      await expect(manager.run('test', operation)).rejects.toThrow('Connection terminated unexpectedly')
      expect(operation).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the client was already dead when the statement was about to be sent', () => {
    let operation: jest.Mock<Promise<string>, [{ markStatementSent(): void }]>
    let result: string

    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest
        .fn()
        .mockImplementationOnce(async (context: { markStatementSent(): void }) => {
          context.markStatementSent()
          throw new Error('Client has encountered a connection error and is not queryable')
        })
        .mockResolvedValueOnce('ok')
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
      result = await manager.run('test', operation)
    })

    it('should retry the operation, since the statement never reached the server', () => {
      expect(result).toBe('ok')
    })
  })

  describe('and the operation opts out of retrying once the statement was sent', () => {
    let operation: jest.Mock<Promise<string>, [{ markStatementSent(): void }]>

    beforeEach(() => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest.fn().mockImplementation(async (context: { markStatementSent(): void }) => {
        context.markStatementSent()
        throw new Error('Client has encountered a connection error and is not queryable')
      })
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
    })

    it('should reject without retrying, even though the error proves the statement never left', async () => {
      await expect(manager.run('test', operation, { retryAfterStatementSent: false })).rejects.toThrow('not queryable')
      expect(operation).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the operation opts out of retrying while also declared idempotent', () => {
    let operation: jest.Mock<Promise<string>, [{ markStatementSent(): void }]>

    beforeEach(() => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest.fn().mockImplementation(async (context: { markStatementSent(): void }) => {
        context.markStatementSent()
        throw new Error('Connection terminated unexpectedly')
      })
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
    })

    it('should reject without retrying, since the opt-out wins over the idempotency declaration', async () => {
      await expect(
        manager.run('test', operation, { retryAfterStatementSent: false, retrySentStatements: true })
      ).rejects.toThrow('Connection terminated unexpectedly')
      expect(operation).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the operation is declared idempotent', () => {
    let operation: jest.Mock<Promise<string>, [{ markStatementSent(): void }]>
    let result: string

    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest
        .fn()
        .mockImplementationOnce(async (context: { markStatementSent(): void }) => {
          context.markStatementSent()
          throw new Error('Connection terminated unexpectedly')
        })
        .mockResolvedValueOnce('ok')
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
      result = await manager.run('test', operation, { retrySentStatements: true })
    })

    it('should retry the operation and return its result', () => {
      expect(result).toBe('ok')
    })
  })

  describe('and reconnection is disabled', () => {
    let operation: jest.Mock<Promise<string>, []>

    beforeEach(() => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      manager = createReconnectionManager({ logs }, { ...FAST_OPTIONS, enabled: false }, probeConnection)
    })

    it('should reject on the first failure without retrying', async () => {
      await expect(manager.run('test', operation)).rejects.toThrow('connect ECONNREFUSED')
      expect(operation).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the manager was stopped', () => {
    let operation: jest.Mock<Promise<string>, []>

    beforeEach(() => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      operation = jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
      manager.stop()
    })

    it('should reject on the first failure without retrying', async () => {
      await expect(manager.run('test', operation)).rejects.toThrow('connect ECONNREFUSED')
      expect(operation).toHaveBeenCalledTimes(1)
    })
  })
})

describe('when the reconnection manager tracks the connection status', () => {
  let logs: ILoggerComponent
  let probeConnection: jest.Mock<Promise<void>, []>
  let manager: ReconnectionManager
  let onDisconnection: jest.Mock<void, [Error]>
  let onReconnection: jest.Mock<void, [number]>

  afterEach(() => {
    manager.stop()
  })

  describe('and the database becomes unreachable', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      onDisconnection = jest.fn()
      onReconnection = jest.fn()
      probeConnection = jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      manager = createReconnectionManager(
        { logs },
        { ...FAST_OPTIONS, enabled: false, onDisconnection, onReconnection },
        probeConnection
      )
      manager.notifySuccess()
      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
    })

    it('should report the connection as lost', () => {
      expect(manager.getStatus().connected).toBe(false)
    })

    it('should report the message of the error that broke the connection', () => {
      expect(manager.getStatus().lastError).toBe('connect ECONNREFUSED')
    })

    it('should count the outage', () => {
      expect(manager.getStatus().disconnections).toBe(1)
    })

    it('should notify the disconnection listener once', () => {
      expect(onDisconnection).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the only failure is a client pg refused to use', () => {
    beforeEach(() => {
      logs = createMockLogs()
      onDisconnection = jest.fn()
      onReconnection = jest.fn()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      manager = createReconnectionManager(
        { logs },
        { ...FAST_OPTIONS, enabled: false, onDisconnection, onReconnection },
        probeConnection
      )
      manager.notifySuccess()
      manager.notifyFailure(new Error('Client has encountered a connection error and is not queryable'))
    })

    it('should keep reporting the connection as established', () => {
      expect(manager.getStatus().connected).toBe(true)
    })

    it('should not notify the disconnection listener', () => {
      expect(onDisconnection).not.toHaveBeenCalled()
    })
  })

  describe('and the database stays unreachable across several failures', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      onDisconnection = jest.fn()
      onReconnection = jest.fn()
      probeConnection = jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      manager = createReconnectionManager(
        { logs },
        { ...FAST_OPTIONS, enabled: false, onDisconnection, onReconnection },
        probeConnection
      )
      manager.notifySuccess()
      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
    })

    it('should notify the disconnection listener only for the transition', () => {
      expect(onDisconnection).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the database becomes reachable again', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      onDisconnection = jest.fn()
      onReconnection = jest.fn()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      manager = createReconnectionManager(
        { logs },
        { ...FAST_OPTIONS, enabled: false, onDisconnection, onReconnection },
        probeConnection
      )
      manager.notifySuccess()
      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      await manager.probe()
    })

    it('should report the connection as established', () => {
      expect(manager.getStatus().connected).toBe(true)
    })

    it('should notify the reconnection listener with the downtime', () => {
      expect(onReconnection).toHaveBeenCalledWith(expect.any(Number))
    })
  })

  describe('and a probe runs while the database is unreachable', () => {
    let reachable: boolean

    beforeEach(async () => {
      logs = createMockLogs()
      onDisconnection = jest.fn()
      onReconnection = jest.fn()
      probeConnection = jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      manager = createReconnectionManager(
        { logs },
        { ...FAST_OPTIONS, enabled: false, onDisconnection, onReconnection },
        probeConnection
      )
      reachable = await manager.probe()
    })

    it('should report the database as unreachable instead of throwing', () => {
      expect(reachable).toBe(false)
    })
  })

  describe('and several probes are requested concurrently', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      manager = createReconnectionManager({ logs }, { ...FAST_OPTIONS, enabled: false }, probeConnection)
      await Promise.all([manager.probe(), manager.probe(), manager.probe()])
    })

    it('should deduplicate them into a single connection check', () => {
      expect(probeConnection).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the background reconnection loop restores the connection', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      onDisconnection = jest.fn()
      onReconnection = jest.fn()
      probeConnection = jest
        .fn()
        .mockRejectedValueOnce(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
        .mockResolvedValue(undefined)
      manager = createReconnectionManager(
        { logs },
        { ...FAST_OPTIONS, onDisconnection, onReconnection },
        probeConnection
      )
      manager.notifySuccess()
      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))

      // The loop probes on its own backoff schedule; wait for it to report the connection back.
      while (!manager.getStatus().connected) {
        await new Promise((resolve) => global.setTimeout(resolve, 5))
      }
    })

    it('should report the connection as established without any operation running', () => {
      expect(manager.getStatus().connected).toBe(true)
    })

    it('should notify the reconnection listener once', () => {
      expect(onReconnection).toHaveBeenCalledTimes(1)
    })
  })
})

describe('when the reconnection manager is stopped while an operation is waiting to be retried', () => {
  let logs: ILoggerComponent
  let manager: ReconnectionManager
  let operation: jest.Mock<Promise<string>, []>
  let runError: Error | undefined

  beforeEach(async () => {
    logs = createMockLogs()
    operation = jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
    manager = createReconnectionManager(
      { logs },
      { ...FAST_OPTIONS, initialDelayInMilliseconds: 1000, maxDelayInMilliseconds: 1000 },
      jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
    )

    const runPromise = manager.run('test', operation)
    await new Promise((resolve) => global.setTimeout(resolve, 20))
    manager.stop()

    runError = undefined
    try {
      await runPromise
    } catch (error) {
      runError = error as Error
    }
  })

  it('should reject as unavailable, carrying the failure that opened the circuit as the cause', () => {
    expect(runError).toBeInstanceOf(DatabaseUnavailableError)
    expect((runError as DatabaseUnavailableError).cause).toMatchObject({ message: 'connect ECONNREFUSED' })
  })

  it('should not attempt the operation again', () => {
    expect(operation).toHaveBeenCalledTimes(1)
  })
})

describe('when a connection status listener throws', () => {
  let logs: ILoggerComponent
  let manager: ReconnectionManager
  let onDisconnection: jest.Mock<void, [Error]>

  beforeEach(() => {
    logs = createMockLogs()
    onDisconnection = jest.fn().mockImplementation(() => {
      throw new Error('listener blew up')
    })
    manager = createReconnectionManager(
      { logs },
      { ...FAST_OPTIONS, enabled: false, onDisconnection },
      jest.fn().mockResolvedValue(undefined)
    )
    manager.notifySuccess()
    manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
  })

  afterEach(() => {
    manager.stop()
  })

  it('should still record the disconnection', () => {
    expect(manager.getStatus().connected).toBe(false)
  })
})

describe('when a probe is scheduled while reconnection is disabled', () => {
  let logs: ILoggerComponent
  let manager: ReconnectionManager
  let probeConnection: jest.Mock<Promise<void>, []>

  beforeEach(() => {
    logs = createMockLogs()
    probeConnection = jest.fn().mockResolvedValue(undefined)
    manager = createReconnectionManager({ logs }, { ...FAST_OPTIONS, enabled: false }, probeConnection)
    manager.scheduleProbe(new Error('Connection terminated unexpectedly'))
  })

  afterEach(() => {
    manager.stop()
  })

  it('should not touch the database, since a disabled reconnection does no background work', () => {
    expect(probeConnection).not.toHaveBeenCalled()
  })

  it('should still record what broke the connection', () => {
    expect(manager.getStatus().lastError).toBe('Connection terminated unexpectedly')
  })
})

describe('when a probe is scheduled after the reconnection manager was stopped', () => {
  let logs: ILoggerComponent
  let manager: ReconnectionManager
  let probeConnection: jest.Mock<Promise<void>, []>

  beforeEach(() => {
    logs = createMockLogs()
    probeConnection = jest.fn().mockResolvedValue(undefined)
    manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)
    manager.stop()
    manager.scheduleProbe(new Error('Connection terminated unexpectedly'))
  })

  it('should not touch the database', () => {
    expect(probeConnection).not.toHaveBeenCalled()
  })
})

describe('when the database flaps in and out', () => {
  let logs: ILoggerComponent
  let probeConnection: jest.Mock<Promise<void>, []>
  let manager: ReconnectionManager
  let onReconnection: jest.Mock<void, [number]>

  afterEach(() => {
    manager.stop()
  })

  describe('and a second outage follows a recovery', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      onReconnection = jest.fn()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      manager = createReconnectionManager({ logs, }, { ...FAST_OPTIONS, onReconnection }, probeConnection)

      manager.notifySuccess()
      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      await waitUntil(() => manager.getStatus().connected)

      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      await waitUntil(() => manager.getStatus().connected)
    })

    it('should start a new loop and recover again, rather than leave the outage unattended', () => {
      expect(onReconnection).toHaveBeenCalledTimes(2)
    })

    it('should count both outages', () => {
      expect(manager.getStatus().disconnections).toBe(2)
    })
  })

  describe('and failures keep arriving while the database is still down', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      manager = createReconnectionManager({ logs }, FAST_OPTIONS, probeConnection)

      manager.notifySuccess()
      for (let failure = 0; failure < 20; failure++) {
        manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      }
      await waitUntil(() => probeConnection.mock.calls.length >= 2)
    })

    it('should keep a single loop probing instead of one per failure', () => {
      // 20 failures against a deduplicated probe and a single loop: an unguarded restart would have
      // fanned out into a probe per failure.
      expect(probeConnection.mock.calls.length).toBeLessThan(10)
    })
  })
})

describe('when the database is pinged repeatedly', () => {
  let logs: ILoggerComponent
  let manager: ReconnectionManager
  let probeConnection: jest.Mock<Promise<void>, []>

  afterEach(() => {
    manager.stop()
  })

  describe('and the pings arrive faster than the initial backoff delay', () => {
    let verdicts: boolean[]

    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      manager = createReconnectionManager(
        { logs },
        { ...FAST_OPTIONS, enabled: false, initialDelayInMilliseconds: 200 },
        probeConnection
      )
      verdicts = [await manager.probe(), await manager.probe(), await manager.probe()]
    })

    it('should answer every ping', () => {
      expect(verdicts).toEqual([true, true, true])
    })

    it('should have opened a single connection, reusing the verdict for the rest', () => {
      expect(probeConnection).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the initial backoff delay has passed between pings', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      manager = createReconnectionManager(
        { logs },
        { ...FAST_OPTIONS, enabled: false, initialDelayInMilliseconds: 20 },
        probeConnection
      )
      await manager.probe()
      await new Promise((resolve) => global.setTimeout(resolve, 40))
      await manager.probe()
    })

    it('should probe again', () => {
      expect(probeConnection).toHaveBeenCalledTimes(2)
    })
  })

  describe('and the connection state changed since the last verdict', () => {
    let verdictAfterTheChange: boolean

    beforeEach(async () => {
      logs = createMockLogs()
      probeConnection = jest.fn().mockResolvedValue(undefined)
      manager = createReconnectionManager(
        { logs },
        { ...FAST_OPTIONS, enabled: false, initialDelayInMilliseconds: 200 },
        probeConnection
      )
      await manager.probe()
      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      verdictAfterTheChange = await manager.probe()
    })

    it('should not serve the stale verdict', () => {
      expect(probeConnection).toHaveBeenCalledTimes(2)
    })

    it('should report what the fresh probe found', () => {
      expect(verdictAfterTheChange).toBe(true)
    })
  })
})

describe('when a probe outlives its deadline', () => {
  let logs: ILoggerComponent
  let manager: ReconnectionManager
  let probeConnection: jest.Mock<Promise<void>, []>
  let firstVerdict: boolean
  let secondVerdict: boolean
  let callsWhileTheFirstWasPending: number

  beforeEach(async () => {
    logs = createMockLogs()
    // Settles well after the 10ms deadline, the way a driver attempt with a longer timeout would.
    probeConnection = jest.fn().mockImplementation(() => new Promise<void>((resolve) => global.setTimeout(resolve, 60)))
    manager = createReconnectionManager(
      { logs },
      { ...FAST_OPTIONS, enabled: false, probeTimeoutInMilliseconds: 10 },
      probeConnection
    )

    firstVerdict = await manager.probe()
    secondVerdict = await manager.probe()
    callsWhileTheFirstWasPending = probeConnection.mock.calls.length

    await new Promise((resolve) => global.setTimeout(resolve, 80))
    await manager.probe()
  })

  afterEach(() => {
    manager.stop()
  })

  it('should report the deadline as a failure without waiting for the driver', () => {
    expect(firstVerdict).toBe(false)
  })

  it('should hand a second caller the pending attempt rather than start another on top of it', () => {
    expect(secondVerdict).toBe(false)
    expect(callsWhileTheFirstWasPending).toBe(1)
  })

  it('should start a fresh attempt once the first has actually finished', () => {
    expect(probeConnection).toHaveBeenCalledTimes(2)
  })
})

describe('when a probe never answers', () => {
  let logs: ILoggerComponent
  let manager: ReconnectionManager
  let reachable: boolean

  beforeEach(async () => {
    logs = createMockLogs()
    manager = createReconnectionManager(
      { logs },
      { ...FAST_OPTIONS, probeTimeoutInMilliseconds: 30 },
      // A pool with no connection timeout against an unreachable host: never settles.
      jest.fn().mockImplementation(() => new Promise<void>(() => undefined))
    )
    reachable = await manager.probe()
  })

  afterEach(() => {
    manager.stop()
  })

  it('should report the database as unreachable instead of hanging', () => {
    expect(reachable).toBe(false)
  })

  it('should record the deadline as the reason', () => {
    expect(manager.getStatus().lastError).toMatch(/did not answer within 30ms/)
  })
})

describe('when a probe runs after the reconnection manager was stopped', () => {
  let logs: ILoggerComponent
  let manager: ReconnectionManager
  let probeConnection: jest.Mock<Promise<void>, []>
  let onDisconnection: jest.Mock<void, [Error]>
  let reachable: boolean

  beforeEach(async () => {
    logs = createMockLogs()
    onDisconnection = jest.fn()
    probeConnection = jest.fn().mockRejectedValue(new Error('Cannot use a pool after calling end on the pool'))
    manager = createReconnectionManager({ logs }, { ...FAST_OPTIONS, onDisconnection }, probeConnection)
    manager.notifySuccess()
    manager.stop()
    reachable = await manager.probe()
  })

  it('should report the database as unreachable', () => {
    expect(reachable).toBe(false)
  })

  it('should not touch the closed pool', () => {
    expect(probeConnection).not.toHaveBeenCalled()
  })

  it('should not report an outage, since the pool was closed on purpose', () => {
    expect(onDisconnection).not.toHaveBeenCalled()
  })
})

describe('when the metrics component declares the reconnection metrics', () => {
  let logs: ILoggerComponent
  let metrics: IMetricsComponent
  let manager: ReconnectionManager

  afterEach(() => {
    manager.stop()
  })

  describe('and an operation recovers from a connection error', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      metrics = createMockMetrics()
      manager = createReconnectionManager({ logs, metrics }, FAST_OPTIONS, jest.fn().mockResolvedValue(undefined))
      await manager.run(
        'test',
        jest
          .fn()
          .mockRejectedValueOnce(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
          .mockResolvedValueOnce('ok')
      )
    })

    it('should count the failed attempt', () => {
      expect(metrics.increment).toHaveBeenCalledWith('dcl_db_reconnection_attempts_total', {
        source: 'operation',
        status: 'failure'
      })
    })

    it('should count the recovery', () => {
      expect(metrics.increment).toHaveBeenCalledWith('dcl_db_reconnection_attempts_total', {
        source: 'operation',
        status: 'success'
      })
    })

    it('should report the database as reachable', () => {
      expect(metrics.observe).toHaveBeenCalledWith('dcl_db_connection_status', {}, 1)
    })
  })

  describe('and an operation exhausts its retries', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      metrics = createMockMetrics()
      manager = createReconnectionManager(
        { logs, metrics },
        { ...FAST_OPTIONS, enabled: false },
        jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
      )
      await manager
        .run('test', jest.fn().mockRejectedValue(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED')))
        .catch(() => undefined)
    })

    it('should count the attempt that exhausted the budget', () => {
      expect(metrics.increment).toHaveBeenCalledWith('dcl_db_reconnection_attempts_total', {
        source: 'operation',
        status: 'failure'
      })
    })
  })

  describe('and an operation fails for a reason unrelated to the connection', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      metrics = createMockMetrics()
      manager = createReconnectionManager({ logs, metrics }, FAST_OPTIONS, jest.fn().mockResolvedValue(undefined))
      await manager
        .run('test', jest.fn().mockRejectedValue(createErrorWithCode('syntax error', '42601')))
        .catch(() => undefined)
    })

    it('should not count it as a reconnection attempt', () => {
      expect(metrics.increment).not.toHaveBeenCalled()
    })
  })

  describe('and the background loop restores the connection', () => {
    beforeEach(async () => {
      logs = createMockLogs()
      metrics = createMockMetrics()
      manager = createReconnectionManager(
        { logs, metrics },
        FAST_OPTIONS,
        jest
          .fn()
          .mockRejectedValueOnce(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))
          .mockResolvedValue(undefined)
      )
      manager.notifySuccess()
      manager.notifyFailure(createErrorWithCode('connect ECONNREFUSED', 'ECONNREFUSED'))

      while (!manager.getStatus().connected) {
        await new Promise((resolve) => global.setTimeout(resolve, 5))
      }
    })

    it('should report the database as unreachable while it was down', () => {
      expect(metrics.observe).toHaveBeenCalledWith('dcl_db_connection_status', {}, 0)
    })

    it('should count the failed probe', () => {
      expect(metrics.increment).toHaveBeenCalledWith('dcl_db_reconnection_attempts_total', {
        source: 'probe',
        status: 'failure'
      })
    })

    it('should count the successful probe', () => {
      expect(metrics.increment).toHaveBeenCalledWith('dcl_db_reconnection_attempts_total', {
        source: 'probe',
        status: 'success'
      })
    })
  })
})

describe('when the metrics component does not declare the reconnection metrics', () => {
  let logs: ILoggerComponent
  let metrics: IMetricsComponent
  let manager: ReconnectionManager
  let result: string

  beforeEach(async () => {
    logs = createMockLogs()
    metrics = {
      startTimer: jest.fn(),
      observe: jest.fn().mockImplementation(() => {
        throw new Error('Unknown metric name')
      }),
      increment: jest.fn(),
      decrement: jest.fn(),
      reset: jest.fn(),
      resetAll: jest.fn(),
      getValue: jest.fn()
    }
    manager = createReconnectionManager({ logs, metrics }, FAST_OPTIONS, jest.fn().mockResolvedValue(undefined))
    result = await manager.run('test', jest.fn().mockResolvedValue('ok'))
  })

  afterEach(() => {
    manager.stop()
  })

  it('should keep serving the operation instead of failing on the metric', () => {
    expect(result).toBe('ok')
  })
})
