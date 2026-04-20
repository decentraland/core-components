import { ILoggerComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { createLoggerMockedComponent, LockNotAcquiredError, LockNotReleasedError } from '@dcl/core-commons'
import { createRedisComponent } from '../src/component'
import { ICacheStorageComponent } from '@dcl/core-commons'

// Mock the redis module
jest.mock('redis', () => ({
  createClient: jest.fn()
}))

let logs: ILoggerComponent
let component: ICacheStorageComponent
let mockRedisClient: any
let connectMock: jest.Mock
let closeMock: jest.Mock
let getMock: jest.Mock
let setMock: jest.Mock
let delMock: jest.Mock
let scanMock: jest.Mock
let hSetMock: jest.Mock
let hGetMock: jest.Mock
let hDelMock: jest.Mock
let hGetAllMock: jest.Mock
let multiMock: jest.Mock
let expireMock: jest.Mock
let execMock: jest.Mock
let evalMock: jest.Mock
let evalShaMock: jest.Mock
let scriptLoadMock: jest.Mock
let errorLogMock: jest.Mock
let debugLogMock: jest.Mock

const hostUrl = 'redis://localhost:6379'

beforeEach(async () => {
  connectMock = jest.fn().mockResolvedValue(undefined)
  closeMock = jest.fn().mockResolvedValue(undefined)
  getMock = jest.fn()
  setMock = jest.fn().mockResolvedValue('OK')
  delMock = jest.fn().mockResolvedValue(1)
  scanMock = jest.fn()
  hSetMock = jest.fn().mockResolvedValue(1)
  hGetMock = jest.fn()
  hDelMock = jest.fn().mockResolvedValue(1)
  hGetAllMock = jest.fn()
  expireMock = jest.fn().mockResolvedValue(1)
  execMock = jest.fn().mockResolvedValue(['OK', 1])
  evalMock = jest.fn()
  evalShaMock = jest.fn()
  scriptLoadMock = jest.fn().mockResolvedValue('dummy-sha')
  multiMock = jest.fn().mockReturnValue({
    hSet: hSetMock,
    expire: expireMock,
    exec: execMock
  })
  errorLogMock = jest.fn()
  debugLogMock = jest.fn()

  mockRedisClient = {
    isOpen: false,
    connect: connectMock.mockImplementation(async () => {
      mockRedisClient.isOpen = true
    }),
    close: closeMock.mockImplementation(async () => {
      mockRedisClient.isOpen = false
    }),
    get: getMock,
    set: setMock,
    del: delMock,
    scan: scanMock,
    hSet: hSetMock,
    hGet: hGetMock,
    hDel: hDelMock,
    hGetAll: hGetAllMock,
    multi: multiMock,
    eval: evalMock,
    evalSha: evalShaMock,
    scriptLoad: scriptLoadMock,
    on: jest.fn()
  }

  const { createClient } = require('redis')
  createClient.mockReturnValue(mockRedisClient)

  logs = createLoggerMockedComponent({
    error: errorLogMock,
    debug: debugLogMock
  })

  component = await createRedisComponent(hostUrl, { logs })
})

describe('when working with mixed-case keys', () => {
  // Redis is case-sensitive. This suite guards against regressing back to
  // the previous behavior that silently lower-cased keys only on some
  // methods, which made `set(K)`/`setInHash(K,…)`/`keys(K*)` refer to
  // different underlying Redis keys.
  const mixedCaseKey = 'MixedCase:Key'
  const serializedValue = JSON.stringify({ ok: true })

  beforeEach(() => {
    getMock.mockResolvedValue(serializedValue)
    hGetAllMock.mockResolvedValue({})
  })

  it('should preserve the original case in get/set/remove/keys/acquireLock/releaseLock/setInHash', async () => {
    await component.set(mixedCaseKey, { ok: true })
    await component.get(mixedCaseKey)
    await component.remove(mixedCaseKey)
    await component.setInHash(mixedCaseKey, 'Field', { ok: true })
    evalMock.mockResolvedValueOnce(1)
    await component.acquireLock(mixedCaseKey, { retries: 1 })
    await component.releaseLock(mixedCaseKey)

    expect(setMock).toHaveBeenCalledWith(mixedCaseKey, serializedValue, undefined)
    expect(getMock).toHaveBeenCalledWith(mixedCaseKey)
    expect(delMock).toHaveBeenCalledWith(mixedCaseKey)
    expect(hSetMock).toHaveBeenCalledWith(mixedCaseKey, 'Field', serializedValue)
    expect(setMock).toHaveBeenCalledWith(mixedCaseKey, expect.any(String), expect.objectContaining({ NX: true }))
    expect(evalMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ keys: [mixedCaseKey] }))
  })
})

describe('when storing and retrieving values', () => {
  const testKey = 'test-key'
  const testValue = { id: 123, name: 'test' }
  const serializedValue = JSON.stringify(testValue)

  describe('and setting a value without TTL', () => {
    beforeEach(async () => {
      await component.set(testKey, testValue)
    })

    it('should call Redis set with the serialized value and no EX option', () => {
      expect(setMock).toHaveBeenCalledWith(testKey, serializedValue, undefined)
    })
  })

  describe('and setting a value with TTL', () => {
    const ttl = 3600

    beforeEach(async () => {
      await component.set(testKey, testValue, ttl)
    })

    it('should call Redis set with TTL', () => {
      expect(setMock).toHaveBeenCalledWith(testKey, serializedValue, { EX: ttl })
    })
  })

  describe('and getting a value that exists', () => {
    beforeEach(() => {
      getMock.mockResolvedValue(serializedValue)
    })

    it('should retrieve and deserialize the value', async () => {
      const result = await component.get(testKey)

      expect(getMock).toHaveBeenCalledWith(testKey)
      expect(result).toEqual(testValue)
    })
  })

  describe('and getting a value that does not exist', () => {
    beforeEach(() => {
      getMock.mockResolvedValue(null)
    })

    it('should return null', async () => {
      const result = await component.get(testKey)

      expect(getMock).toHaveBeenCalledWith(testKey)
      expect(result).toBeNull()
    })
  })

  describe('and removing a value', () => {
    beforeEach(async () => {
      await component.remove(testKey)
    })

    it('should call Redis del command', () => {
      expect(delMock).toHaveBeenCalledWith(testKey)
    })
  })
})

describe('when scanning keys', () => {
  describe('and scanning with default pattern', () => {
    beforeEach(() => {
      scanMock
        .mockResolvedValueOnce({ cursor: '5', keys: ['key1', 'key2'] })
        .mockResolvedValueOnce({ cursor: '0', keys: ['key3'] })
    })

    it('should return all keys from multiple scan iterations', async () => {
      const keys = await component.keys()

      expect(scanMock).toHaveBeenCalledWith('0', { MATCH: '*', COUNT: 100 })
      expect(scanMock).toHaveBeenCalledWith('5', { MATCH: '*', COUNT: 100 })
      expect(keys).toEqual(['key1', 'key2', 'key3'])
    })
  })

  describe('and scanning with custom pattern', () => {
    const pattern = 'user:*'

    beforeEach(() => {
      scanMock.mockResolvedValue({ cursor: '0', keys: ['user:123', 'user:456'] })
    })

    it('should use the provided pattern', async () => {
      const keys = await component.keys(pattern)

      expect(scanMock).toHaveBeenCalledWith('0', { MATCH: pattern, COUNT: 100 })
      expect(keys).toEqual(['user:123', 'user:456'])
    })
  })
})

describe('when setting values in a hash without TTL', () => {
  let hashKey: string
  let field: string
  let value: { id: number; name: string }

  beforeEach(async () => {
    hashKey = 'test-hash'
    field = 'field1'
    value = { id: 1, name: 'value1' }

    await component.setInHash(hashKey, field, value)
  })

  it('should call Redis hSet command without expiry', () => {
    expect(multiMock).toHaveBeenCalled()
    expect(hSetMock).toHaveBeenCalledWith(hashKey, field, JSON.stringify(value))
    expect(expireMock).not.toHaveBeenCalled()
    expect(execMock).toHaveBeenCalled()
  })
})

describe('when setting values in a hash with TTL', () => {
  let hashKey: string
  let field: string
  let value: { id: number; name: string }
  let ttl: number

  beforeEach(async () => {
    hashKey = 'test-hash'
    field = 'field1'
    value = { id: 1, name: 'value1' }
    ttl = 3600

    await component.setInHash(hashKey, field, value, ttl)
  })

  it('should call Redis hSet command with expiry', () => {
    expect(multiMock).toHaveBeenCalled()
    expect(hSetMock).toHaveBeenCalledWith(hashKey, field, JSON.stringify(value))
    expect(expireMock).toHaveBeenCalledWith(hashKey, ttl)
    expect(execMock).toHaveBeenCalled()
  })
})

describe('when setting hash values with zero TTL', () => {
  let hashKey: string
  let field: string
  let value: { id: number; name: string }

  beforeEach(async () => {
    hashKey = 'test-hash'
    field = 'field1'
    value = { id: 1, name: 'value1' }

    await component.setInHash(hashKey, field, value, 0)
  })

  it('should not set expiry for zero TTL', () => {
    expect(multiMock).toHaveBeenCalled()
    expect(hSetMock).toHaveBeenCalledWith(hashKey, field, JSON.stringify(value))
    expect(expireMock).not.toHaveBeenCalled()
    expect(execMock).toHaveBeenCalled()
  })
})

describe('when getting a value from a hash that exists', () => {
  let hashKey: string
  let field: string
  let value: { id: number; name: string }
  let serializedValue: string

  beforeEach(() => {
    hashKey = 'test-hash'
    field = 'field1'
    value = { id: 1, name: 'value1' }
    serializedValue = JSON.stringify(value)

    hGetMock.mockResolvedValue(serializedValue)
  })

  it('should retrieve and deserialize the hash field value', async () => {
    const result = await component.getFromHash(hashKey, field)

    expect(hGetMock).toHaveBeenCalledWith(hashKey, field)
    expect(result).toEqual(value)
  })
})

describe('when getting a value from hash that does not exist', () => {
  let hashKey: string
  let field: string

  beforeEach(() => {
    hashKey = 'test-hash'
    field = 'field1'

    hGetMock.mockResolvedValue(null)
  })

  it('should return null', async () => {
    const result = await component.getFromHash(hashKey, field)

    expect(hGetMock).toHaveBeenCalledWith(hashKey, field)
    expect(result).toBeNull()
  })
})

describe('when removing a field from a hash', () => {
  let hashKey: string
  let field: string

  beforeEach(async () => {
    hashKey = 'test-hash'
    field = 'field1'

    await component.removeFromHash(hashKey, field)
  })

  it('should call the redis deletion command with the hash key and field', () => {
    expect(hDelMock).toHaveBeenCalledWith(hashKey, field)
  })
})

describe('when getting all hash fields', () => {
  let hashKey: string
  let field1: string
  let field2: string
  let value1: { id: number; name: string }
  let value2: { id: number; name: string }
  let hashData: Record<string, string>

  beforeEach(() => {
    hashKey = 'test-hash'
    field1 = 'field1'
    field2 = 'field2'
    value1 = { id: 1, name: 'value1' }
    value2 = { id: 2, name: 'value2' }
    hashData = {
      [field1]: JSON.stringify(value1),
      [field2]: JSON.stringify(value2)
    }

    hGetAllMock.mockResolvedValue(hashData)
  })

  it('should retrieve and deserialize all hash fields', async () => {
    const result = await component.getAllHashFields(hashKey)

    expect(hGetAllMock).toHaveBeenCalledWith(hashKey)
    expect(result).toEqual({
      [field1]: value1,
      [field2]: value2
    })
  })
})

describe('when getting all fields from an empty hash', () => {
  let hashKey: string

  beforeEach(() => {
    hashKey = 'test-hash'

    hGetAllMock.mockResolvedValue({})
  })

  it('should return an empty object', async () => {
    const result = await component.getAllHashFields(hashKey)

    expect(hGetAllMock).toHaveBeenCalledWith(hashKey)
    expect(result).toEqual({})
  })
})

describe('when acquiring locks', () => {
  const lockKey = 'test-lock'

  describe('and the lock is successfully acquired on first try', () => {
    beforeEach(() => {
      setMock.mockResolvedValue('OK')
    })

    it('should acquire the lock with custom retry options', async () => {
      await component.acquireLock(lockKey, {
        ttlInMilliseconds: 5000,
        retryDelayInMilliseconds: 100,
        retries: 5
      })

      expect(setMock).toHaveBeenCalledWith(lockKey, expect.any(String), { NX: true, PX: 5000 })
    })
  })

  describe('and the lock is acquired after retries', () => {
    beforeEach(() => {
      setMock
        .mockResolvedValueOnce(null) // First attempt fails
        .mockResolvedValueOnce(null) // Second attempt fails
        .mockResolvedValueOnce('OK') // Third attempt succeeds
    })

    it('should retry and eventually acquire the lock', async () => {
      const retryDelay = 50
      const retries = 5

      await component.acquireLock(lockKey, {
        retryDelayInMilliseconds: retryDelay,
        retries
      })

      expect(setMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('and the lock cannot be acquired after all retries', () => {
    beforeEach(() => {
      setMock.mockResolvedValue(null) // All attempts fail
    })

    it('should throw LockNotAcquiredError after exhausting retries', async () => {
      const retries = 3

      await expect(component.acquireLock(lockKey, { retries })).rejects.toThrow(LockNotAcquiredError)

      expect(setMock).toHaveBeenCalledTimes(retries)
    })
  })
})

describe('when releasing locks', () => {
  const lockKey = 'test-lock'

  describe('and the lock is successfully released', () => {
    beforeEach(() => {
      evalMock.mockResolvedValue(1) // Lock was owned and deleted
    })

    it('should release the lock successfully', async () => {
      await component.releaseLock(lockKey)

      expect(evalMock).toHaveBeenCalledWith(expect.stringContaining('if redis.call("GET", KEYS[1]) == ARGV[1]'), {
        keys: [lockKey],
        arguments: [expect.any(String)]
      })
    })
  })

  describe('and the lock is not owned by this instance', () => {
    beforeEach(() => {
      evalMock.mockResolvedValue(0) // Lock was not owned by this instance
    })

    it('should throw LockNotReleasedError', async () => {
      await expect(component.releaseLock(lockKey)).rejects.toThrow(LockNotReleasedError)

      expect(evalMock).toHaveBeenCalledWith(expect.stringContaining('if redis.call("GET", KEYS[1]) == ARGV[1]'), {
        keys: [lockKey],
        arguments: [expect.any(String)]
      })
    })
  })

  describe('and there is an error during release', () => {
    const error = new Error('Redis connection error')

    beforeEach(() => {
      evalMock.mockRejectedValue(error)
    })

    it('should throw an error', async () => {
      await expect(component.releaseLock(lockKey)).rejects.toThrow(error)
    })
  })
})

describe('when trying to acquire locks', () => {
  const lockKey = 'test-lock'

  describe('and the lock is successfully acquired', () => {
    beforeEach(() => {
      setMock.mockResolvedValue('OK')
    })

    it('should return true', async () => {
      const result = await component.tryAcquireLock(lockKey)

      expect(result).toBe(true)
      expect(setMock).toHaveBeenCalledWith(lockKey, expect.any(String), { NX: true, PX: 10000 })
    })

    it('should return true with custom options', async () => {
      const result = await component.tryAcquireLock(lockKey, {
        ttlInMilliseconds: 5000,
        retries: 2
      })

      expect(result).toBe(true)
      expect(setMock).toHaveBeenCalledWith(lockKey, expect.any(String), { NX: true, PX: 5000 })
    })
  })

  describe('and the lock cannot be acquired', () => {
    beforeEach(() => {
      setMock.mockResolvedValue(null) // All attempts fail
    })

    it('should return false after exhausting retries', async () => {
      const result = await component.tryAcquireLock(lockKey, { retries: 2 })

      expect(result).toBe(false)
      expect(setMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('and there is a Redis error', () => {
    const error = new Error('Redis connection error')

    beforeEach(() => {
      setMock.mockRejectedValue(error)
    })

    it('should throw the Redis error', async () => {
      await expect(component.tryAcquireLock(lockKey)).rejects.toThrow(error)
    })
  })
})

describe('when trying to release locks', () => {
  const lockKey = 'test-lock'

  describe('and the lock is successfully released', () => {
    beforeEach(() => {
      evalMock.mockResolvedValue(1) // Lock was owned and deleted
    })

    it('should return true', async () => {
      const result = await component.tryReleaseLock(lockKey)

      expect(result).toBe(true)
      expect(evalMock).toHaveBeenCalledWith(expect.stringContaining('if redis.call("GET", KEYS[1]) == ARGV[1]'), {
        keys: [lockKey],
        arguments: [expect.any(String)]
      })
    })
  })

  describe('and the lock is not owned by this instance', () => {
    beforeEach(() => {
      evalMock.mockResolvedValue(0) // Lock was not owned by this instance
    })

    it('should return false', async () => {
      const result = await component.tryReleaseLock(lockKey)

      expect(result).toBe(false)
      expect(evalMock).toHaveBeenCalledWith(expect.stringContaining('if redis.call("GET", KEYS[1]) == ARGV[1]'), {
        keys: [lockKey],
        arguments: [expect.any(String)]
      })
    })
  })

  describe('and there is a Redis error', () => {
    const error = new Error('Redis connection error')

    beforeEach(() => {
      evalMock.mockRejectedValue(error)
    })

    it('should throw the Redis error', async () => {
      await expect(component.tryReleaseLock(lockKey)).rejects.toThrow(error)
    })
  })
})

describe('when starting the component', () => {
  describe('and the client has not been opened yet', () => {
    it('should call connect()', async () => {
      await component[START_COMPONENT]!({ started: () => true, live: () => true, getComponents: () => ({}) })

      expect(connectMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and start is called twice in a row', () => {
    it('should not re-open an already-open client', async () => {
      await component[START_COMPONENT]!({ started: () => true, live: () => true, getComponents: () => ({}) })
      await component[START_COMPONENT]!({ started: () => true, live: () => true, getComponents: () => ({}) })

      // The second start is a no-op because the client is already open.
      expect(connectMock).toHaveBeenCalledTimes(1)
    })
  })
})

describe('when stopping the component', () => {
  describe('and the client is currently open', () => {
    beforeEach(async () => {
      await component[START_COMPONENT]!({ started: () => true, live: () => true, getComponents: () => ({}) })
    })

    it('should call close()', async () => {
      await component[STOP_COMPONENT]!()

      expect(closeMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and stop is called without a prior start', () => {
    it('should not call close()', async () => {
      await component[STOP_COMPONENT]!()

      expect(closeMock).not.toHaveBeenCalled()
    })
  })

  describe('and stop is called twice in a row', () => {
    beforeEach(async () => {
      await component[START_COMPONENT]!({ started: () => true, live: () => true, getComponents: () => ({}) })
    })

    it('should only close the client once', async () => {
      await component[STOP_COMPONENT]!()
      await component[STOP_COMPONENT]!()

      expect(closeMock).toHaveBeenCalledTimes(1)
    })
  })
})

describe('when get returns an empty string from Redis', () => {
  // An empty string is a malformed value (values written by this
  // component are JSON-encoded, so strings always come back wrapped in
  // quotes — `JSON.stringify('') === '""'`). Letting it reach JSON.parse
  // surfaces the corruption to the caller instead of silently returning
  // null as if the key were absent.
  const key = 'empty-string-key'

  beforeEach(() => {
    getMock.mockResolvedValue('')
  })

  it('should throw the parse error rather than silently return null', async () => {
    await expect(component.get(key)).rejects.toThrow()
  })
})

describe('when getAllHashFields encounters a malformed JSON value', () => {
  const hashKey = 'hash-with-bad-field'

  beforeEach(() => {
    hGetAllMock.mockResolvedValue({
      good: JSON.stringify({ ok: true }),
      bad: 'not-valid-json{'
    })
  })

  it('should surface the offending field name in the structured log before throwing', async () => {
    await expect(component.getAllHashFields(hashKey)).rejects.toThrow()

    expect(errorLogMock).toHaveBeenCalledWith(
      'Failed to parse hash field',
      expect.objectContaining({ key: hashKey, field: 'bad' })
    )
  })
})

describe('when getFromHash encounters a malformed JSON value', () => {
  let hashKey: string
  let field: string

  beforeEach(() => {
    hashKey = 'single-field-hash'
    field = 'corrupt-field'
    hGetMock.mockResolvedValue('not-valid-json{')
  })

  it('should reject with the underlying parse error', async () => {
    await expect(component.getFromHash(hashKey, field)).rejects.toThrow()
  })

  it('should surface the offending key and field in the structured log', async () => {
    await component.getFromHash(hashKey, field).catch(() => undefined)

    expect(errorLogMock).toHaveBeenCalledWith(
      'Failed to parse hash field',
      expect.objectContaining({ key: hashKey, field })
    )
  })
})

describe('when acquireLock is given a non-positive ttlInMilliseconds', () => {
  const lockKey = 'clamped-lock'

  beforeEach(() => {
    setMock.mockResolvedValue('OK')
  })

  it('should clamp a zero ttl to the default instead of letting Redis reject PX: 0', async () => {
    await component.acquireLock(lockKey, { ttlInMilliseconds: 0, retries: 1 })

    expect(setMock).toHaveBeenCalledWith(
      lockKey,
      expect.any(String),
      expect.objectContaining({ NX: true, PX: 10000 })
    )
  })

  it('should clamp a negative ttl the same way', async () => {
    await component.acquireLock(lockKey, { ttlInMilliseconds: -1, retries: 1 })

    expect(setMock).toHaveBeenCalledWith(
      lockKey,
      expect.any(String),
      expect.objectContaining({ NX: true, PX: 10000 })
    )
  })
})

describe('when acquireLock retries across multiple attempts', () => {
  const lockKey = 'jittered-lock'

  beforeEach(() => {
    setMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('OK')
  })

  it('should apply equal jitter — each sleep lands within [delay/2, delay)', async () => {
    // Deterministic jitter: pin Math.random so we can check the exact
    // values. With random === 0.5 and retryDelay === 100, the sleep
    // per retry is 100/2 + floor(0.5 * 100/2) = 50 + 25 = 75 ms.
    const originalRandom = Math.random
    Math.random = () => 0.5
    try {
      const start = Date.now()
      await component.acquireLock(lockKey, { retryDelayInMilliseconds: 100, retries: 5 })
      const elapsed = Date.now() - start

      // Two sleeps between the three set attempts, each 75 ms.
      expect(elapsed).toBeGreaterThanOrEqual(140)
      expect(elapsed).toBeLessThan(220)
    } finally {
      Math.random = originalRandom
    }
  })
})

describe('when the connection lifecycle emits events', () => {
  // The 'error' listener was the only one wired pre-fix. The component
  // now also logs 'reconnecting', 'ready', and 'end' at debug level so
  // a dropped/recovered connection is visible in operator logs.
  let onCalls: Array<[string, (...args: any[]) => void]>

  beforeEach(async () => {
    // Re-build the component with a fresh on-spy so we can inspect the
    // exact event-name/listener pairs it registered.
    onCalls = []
    const freshClient = {
      ...mockRedisClient,
      on: jest.fn((event: string, listener: (...args: any[]) => void) => {
        onCalls.push([event, listener])
      })
    }
    const { createClient } = require('redis')
    createClient.mockReturnValue(freshClient)
    await createRedisComponent(hostUrl, { logs })
  })

  it('should register error, reconnecting, ready, and end listeners', () => {
    const events = onCalls.map(([event]) => event).sort()
    expect(events).toEqual(['end', 'error', 'ready', 'reconnecting'])
  })

  it('should log a debug entry when the client reconnects', () => {
    const reconnecting = onCalls.find(([event]) => event === 'reconnecting')![1]
    reconnecting()

    expect(debugLogMock).toHaveBeenCalledWith('Redis client reconnecting')
  })

  it('should log a debug entry when the client becomes ready', () => {
    const ready = onCalls.find(([event]) => event === 'ready')![1]
    ready()

    expect(debugLogMock).toHaveBeenCalledWith('Redis client ready')
  })

  it('should log a debug entry when the connection ends', () => {
    const end = onCalls.find(([event]) => event === 'end')![1]
    end()

    expect(debugLogMock).toHaveBeenCalledWith('Redis client connection ended')
  })
})

describe('when setInHash is called and the transaction contains a per-command error', () => {
  // node-redis's MULTI resolves with per-command Error instances when a
  // queued command failed; it does not throw the whole transaction. If
  // the component didn't inspect the reply, a partial failure would be
  // silently reported as success.
  const hashKey = 'hash'
  const field = 'field'

  beforeEach(() => {
    execMock.mockResolvedValue([new Error('WRONGTYPE Operation against a key holding the wrong kind of value')])
  })

  it('should throw the per-command error so the caller sees the failure', async () => {
    await expect(component.setInHash(hashKey, field, { a: 1 })).rejects.toThrow(/WRONGTYPE/)
  })

  it('should log the failure with the key and field context', async () => {
    await expect(component.setInHash(hashKey, field, { a: 1 })).rejects.toThrow()

    expect(errorLogMock).toHaveBeenCalledWith(
      'Error setting hash field',
      expect.objectContaining({ key: hashKey, field })
    )
  })
})

describe('when start() is called concurrently', () => {
  // Regression: the previous `if (client.isOpen) return` only protected
  // against sequential double-starts. Two callers firing before the
  // first connect resolves would both see `isOpen: false` and race.
  // The gate now funnels them onto a single startPromise.
  let freshComponent: ICacheStorageComponent
  let slowConnect: jest.Mock
  let resolveConnect: () => void
  const lifecycleOptions = { started: () => true, live: () => true, getComponents: () => ({}) }

  beforeEach(async () => {
    slowConnect = jest.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveConnect = () => {
          mockRedisClient.isOpen = true
          resolve()
        }
      })
    })

    const freshClient = { ...mockRedisClient, isOpen: false, connect: slowConnect }
    const { createClient } = require('redis')
    createClient.mockReturnValue(freshClient)
    freshComponent = await createRedisComponent(hostUrl, { logs })

    // Fire two start() calls before the first resolves so the gate
    // actually has something to deduplicate.
    const a = freshComponent[START_COMPONENT]!(lifecycleOptions)
    const b = freshComponent[START_COMPONENT]!(lifecycleOptions)
    resolveConnect()
    await Promise.all([a, b])
  })

  it('should issue connect() exactly once, funnelling both callers onto the same in-flight promise', () => {
    expect(slowConnect).toHaveBeenCalledTimes(1)
  })
})

describe('when the Redis URL contains credentials', () => {
  // The `hostUrl` was logged at debug level verbatim, which meant a
  // managed-Redis password (very common shape) would show up in the
  // connection-start log.
  let credentialedUrl: string
  const lifecycleOptions = { started: () => true, live: () => true, getComponents: () => ({}) }

  beforeEach(async () => {
    credentialedUrl = 'redis://default:supersecret@example.com:6379'
    const freshClient = { ...mockRedisClient, isOpen: false }
    const { createClient } = require('redis')
    createClient.mockReturnValue(freshClient)
    const comp = await createRedisComponent(credentialedUrl, { logs })
    await comp[START_COMPONENT]!(lifecycleOptions)
  })

  it('should log the connect line with the user-info section redacted', () => {
    expect(debugLogMock).toHaveBeenCalledWith('Connecting to Redis', {
      hostUrl: 'redis://***:***@example.com:6379'
    })
  })

  it('should never emit the raw password in any debug log call', () => {
    for (const call of debugLogMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('supersecret')
    }
  })
})

describe('when a write is given an undefined value', () => {
  // Mirror the memory-cache guard: JSON.stringify(undefined) === undefined,
  // which node-redis then serialises inconsistently — reject synchronously
  // so both implementations of ICacheStorageComponent agree.
  let key: string

  beforeEach(() => {
    key = 'undefined-target'
  })

  describe('and set() is called', () => {
    it('should reject with an error that mentions the undefined value', async () => {
      await expect(component.set(key, undefined as unknown as string)).rejects.toThrow(/undefined value/)
    })

    it('should never reach the underlying client', async () => {
      await component.set(key, undefined as unknown as string).catch(() => undefined)

      expect(setMock).not.toHaveBeenCalled()
    })
  })

  describe('and setInHash() is called', () => {
    let field: string

    beforeEach(() => {
      field = 'f'
    })

    it('should reject with an error that mentions the undefined value', async () => {
      await expect(
        component.setInHash(key, field, undefined as unknown as string)
      ).rejects.toThrow(/undefined value/)
    })

    it('should never reach the underlying client', async () => {
      await component
        .setInHash(key, field, undefined as unknown as string)
        .catch(() => undefined)

      expect(hSetMock).not.toHaveBeenCalled()
    })
  })
})

describe('when the client error handler fires with a stack-bearing Error', () => {
  let onCalls: Array<[string, (...args: any[]) => void]>
  let err: Error

  beforeEach(async () => {
    onCalls = []
    const freshClient = {
      ...mockRedisClient,
      on: jest.fn((event: string, listener: (...args: any[]) => void) => {
        onCalls.push([event, listener])
      })
    }
    const { createClient } = require('redis')
    createClient.mockReturnValue(freshClient)
    await createRedisComponent(hostUrl, { logs })

    err = new Error('boom')
    const handler = onCalls.find(([event]) => event === 'error')![1]
    handler(err)
  })

  it('should include the error message in the structured payload', () => {
    expect(errorLogMock).toHaveBeenCalledWith(
      'Redis client error',
      expect.objectContaining({ error: 'boom' })
    )
  })

  it('should include the stack trace in the structured payload', () => {
    expect(errorLogMock).toHaveBeenCalledWith(
      'Redis client error',
      expect.objectContaining({ stack: err.stack })
    )
  })
})

describe('when releaseLock caches the Lua script via EVALSHA', () => {
  let lockKey: string

  beforeEach(() => {
    lockKey = 'releasable-lock'
  })

  describe('and it is the first call against the component', () => {
    beforeEach(async () => {
      evalMock.mockResolvedValue(1)
      scriptLoadMock.mockResolvedValue('cached-sha')

      await component.releaseLock(lockKey)
      // Best-effort SCRIPT LOAD is fired off the critical path; give
      // the microtask queue two ticks to settle before asserting.
      await Promise.resolve()
      await Promise.resolve()
    })

    it('should execute the release via EVAL', () => {
      expect(evalMock).toHaveBeenCalledTimes(1)
    })

    it('should kick off SCRIPT LOAD to prime EVALSHA for the next call', () => {
      expect(scriptLoadMock).toHaveBeenCalled()
    })
  })

  describe('and a previous call has primed the SHA cache', () => {
    beforeEach(async () => {
      evalMock.mockResolvedValue(1)
      scriptLoadMock.mockResolvedValue('cached-sha')
      evalShaMock.mockResolvedValue(1)

      // Prime: EVAL + async SCRIPT LOAD.
      await component.releaseLock(lockKey)
      await Promise.resolve()
      await Promise.resolve()

      // The second call is the one under test.
      await component.releaseLock(lockKey)
    })

    it('should execute the release via EVALSHA on the second call', () => {
      expect(evalShaMock).toHaveBeenCalledTimes(1)
    })

    it('should pass the cached SHA and the lock key as its EVALSHA arguments', () => {
      expect(evalShaMock).toHaveBeenCalledWith(
        'cached-sha',
        expect.objectContaining({ keys: [lockKey] })
      )
    })
  })

  describe('and the Redis server replies NOSCRIPT', () => {
    beforeEach(async () => {
      evalMock.mockResolvedValue(1)
      scriptLoadMock.mockResolvedValue('cached-sha')
      evalShaMock
        .mockRejectedValueOnce(new Error('NOSCRIPT No matching script. Please use EVAL.'))
        .mockResolvedValue(1)

      // Prime the SHA via a successful first call.
      await component.releaseLock(lockKey)
      await Promise.resolve()
      await Promise.resolve()
      evalMock.mockClear()

      // The second call observes the NOSCRIPT and falls back.
      await component.releaseLock(lockKey)
    })

    it('should fall back to EVAL for the release', () => {
      expect(evalMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the client does not expose scriptLoad at all', () => {
    let comp: ICacheStorageComponent

    beforeEach(async () => {
      evalMock.mockResolvedValue(1)
      const freshClient = { ...mockRedisClient, isOpen: false, scriptLoad: undefined }
      const { createClient } = require('redis')
      createClient.mockReturnValue(freshClient)
      comp = await createRedisComponent(hostUrl, { logs })
    })

    it('should still resolve releaseLock via EVAL without throwing', async () => {
      await expect(comp.releaseLock(lockKey)).resolves.not.toThrow()
    })
  })
})
