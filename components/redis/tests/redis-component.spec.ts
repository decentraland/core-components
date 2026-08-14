import { ILoggerComponent, START_COMPONENT } from '@well-known-components/interfaces'
import { createLoggerMockedComponent, LockNotAcquiredError, LockNotReleasedError } from '@dcl/core-commons'
import { createRedisComponent, INCREMENT_SCRIPT, RELEASE_LOCK_SCRIPT } from '../src/component'
import { ICacheStorageComponent } from '@dcl/core-commons'

// Mock the redis module
jest.mock('redis', () => ({
  createClient: jest.fn()
}))

let logs: ILoggerComponent
let component: ICacheStorageComponent
let mockRedisClient: any
let connectMock: jest.Mock
let quitMock: jest.Mock
let getMock: jest.Mock
let setMock: jest.Mock
let delMock: jest.Mock
let existsMock: jest.Mock
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
let debugLogMock: jest.Mock
let errorLogMock: jest.Mock
let warnLogMock: jest.Mock

const hostUrl = 'redis://localhost:6379'

beforeEach(async () => {
  connectMock = jest.fn().mockResolvedValue(undefined)
  quitMock = jest.fn().mockResolvedValue(undefined)
  getMock = jest.fn()
  setMock = jest.fn().mockResolvedValue('OK')
  delMock = jest.fn().mockResolvedValue(1)
  existsMock = jest.fn().mockResolvedValue(0)
  scanMock = jest.fn()
  hSetMock = jest.fn().mockResolvedValue(1)
  hGetMock = jest.fn()
  hDelMock = jest.fn().mockResolvedValue(1)
  hGetAllMock = jest.fn()
  expireMock = jest.fn().mockResolvedValue(1)
  execMock = jest.fn().mockResolvedValue(['OK', 1])
  evalMock = jest.fn()
  evalShaMock = jest.fn()
  multiMock = jest.fn().mockReturnValue({
    hSet: hSetMock,
    expire: expireMock,
    exec: execMock
  })
  debugLogMock = jest.fn()
  errorLogMock = jest.fn()
  warnLogMock = jest.fn()

  mockRedisClient = {
    connect: connectMock,
    quit: quitMock,
    get: getMock,
    set: setMock,
    del: delMock,
    exists: existsMock,
    scan: scanMock,
    hSet: hSetMock,
    hGet: hGetMock,
    hDel: hDelMock,
    hGetAll: hGetAllMock,
    multi: multiMock,
    eval: evalMock,
    evalSha: evalShaMock,
    on: jest.fn()
  }

  const { createClient } = require('redis')
  createClient.mockReturnValue(mockRedisClient)

  logs = createLoggerMockedComponent({
    error: errorLogMock,
    warn: warnLogMock,
    debug: debugLogMock
  })

  component = await createRedisComponent(hostUrl, { logs })
})

describe('when storing and retrieving values', () => {
  const testKey = 'test-key'
  const testValue = { id: 123, name: 'test' }
  const serializedValue = JSON.stringify(testValue)

  describe('and setting a value without TTL', () => {
    beforeEach(async () => {
      await component.set(testKey, testValue)
    })

    it('should call Redis set with serialized value', () => {
      expect(setMock).toHaveBeenCalledWith(testKey.toLowerCase(), serializedValue, { EX: undefined })
    })
  })

  describe('and setting a value with TTL', () => {
    const ttl = 3600

    beforeEach(async () => {
      await component.set(testKey, testValue, ttl)
    })

    it('should call Redis set with TTL', () => {
      expect(setMock).toHaveBeenCalledWith(testKey.toLowerCase(), serializedValue, { EX: ttl })
    })
  })

  describe('and getting a value that exists', () => {
    beforeEach(() => {
      getMock.mockResolvedValue(serializedValue)
    })

    it('should retrieve and deserialize the value', async () => {
      const result = await component.get(testKey)

      expect(getMock).toHaveBeenCalledWith(testKey.toLowerCase())
      expect(result).toEqual(testValue)
    })
  })

  describe('and getting a value that does not exist', () => {
    beforeEach(() => {
      getMock.mockResolvedValue(null)
    })

    it('should return null', async () => {
      const result = await component.get(testKey)

      expect(getMock).toHaveBeenCalledWith(testKey.toLowerCase())
      expect(result).toBeNull()
    })
  })

  describe('and removing a value', () => {
    beforeEach(async () => {
      await component.remove(testKey)
    })

    it('should call Redis del command', () => {
      expect(delMock).toHaveBeenCalledWith(testKey.toLowerCase())
    })
  })

  describe('and checking the existence of a key that is present', () => {
    let result: boolean

    beforeEach(async () => {
      existsMock.mockResolvedValue(1)
      result = await component.exists(testKey)
    })

    it('should call Redis exists with the lowercased key', () => {
      expect(existsMock).toHaveBeenCalledWith(testKey.toLowerCase())
    })

    it('should return true', () => {
      expect(result).toBe(true)
    })
  })

  describe('and checking the existence of a key that is absent', () => {
    let result: boolean

    beforeEach(async () => {
      existsMock.mockResolvedValue(0)
      result = await component.exists(testKey)
    })

    it('should return false', () => {
      expect(result).toBe(false)
    })
  })

  describe('and checking the existence of a key when Redis errors', () => {
    beforeEach(() => {
      existsMock.mockRejectedValue(new Error('boom'))
    })

    it('should rethrow the error', async () => {
      await expect(component.exists(testKey)).rejects.toThrow('boom')
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

      expect(setMock).toHaveBeenCalledWith(lockKey.toLowerCase(), expect.any(String), { NX: true, EX: 5000 })
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
      evalShaMock.mockResolvedValue(1) // Lock was owned and deleted
    })

    it('should release the lock successfully', async () => {
      await component.releaseLock(lockKey)

      expect(evalShaMock).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{40}$/), {
        keys: [lockKey.toLowerCase()],
        arguments: [expect.any(String)]
      })
    })
  })

  describe('and the lock is not owned by this instance', () => {
    beforeEach(() => {
      evalShaMock.mockResolvedValue(0) // Lock was not owned by this instance
    })

    it('should throw LockNotReleasedError', async () => {
      await expect(component.releaseLock(lockKey)).rejects.toThrow(LockNotReleasedError)

      expect(evalShaMock).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{40}$/), {
        keys: [lockKey.toLowerCase()],
        arguments: [expect.any(String)]
      })
    })
  })

  describe('and there is an error during release', () => {
    const error = new Error('Redis connection error')

    beforeEach(() => {
      evalShaMock.mockRejectedValue(error)
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
      expect(setMock).toHaveBeenCalledWith(lockKey.toLowerCase(), expect.any(String), { NX: true, EX: 10000 })
    })

    it('should return true with custom options', async () => {
      const result = await component.tryAcquireLock(lockKey, {
        ttlInMilliseconds: 5000,
        retries: 2
      })

      expect(result).toBe(true)
      expect(setMock).toHaveBeenCalledWith(lockKey.toLowerCase(), expect.any(String), { NX: true, EX: 5000 })
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
      evalShaMock.mockResolvedValue(1) // Lock was owned and deleted
    })

    it('should return true', async () => {
      const result = await component.tryReleaseLock(lockKey)

      expect(result).toBe(true)
      expect(evalShaMock).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{40}$/), {
        keys: [lockKey.toLowerCase()],
        arguments: [expect.any(String)]
      })
    })
  })

  describe('and the lock is not owned by this instance', () => {
    beforeEach(() => {
      evalShaMock.mockResolvedValue(0) // Lock was not owned by this instance
    })

    it('should return false', async () => {
      const result = await component.tryReleaseLock(lockKey)

      expect(result).toBe(false)
      expect(evalShaMock).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{40}$/), {
        keys: [lockKey.toLowerCase()],
        arguments: [expect.any(String)]
      })
    })
  })

  describe('and there is a Redis error', () => {
    const error = new Error('Redis connection error')

    beforeEach(() => {
      evalShaMock.mockRejectedValue(error)
    })

    it('should throw the Redis error', async () => {
      await expect(component.tryReleaseLock(lockKey)).rejects.toThrow(error)
    })
  })
})

describe('when incrementing a counter', () => {
  const counterKey = 'Rate-Limit:Bucket'

  describe('and the counter already has an expiry', () => {
    let result: { value: number; ttlRemainingInMilliseconds?: number }

    beforeEach(async () => {
      evalShaMock.mockResolvedValue([5, 30_000])
      result = await component.increment(counterKey, { ttlInSeconds: 60 })
    })

    it('should return the post-increment value and the remaining lifetime', () => {
      expect(result).toEqual({ value: 5, ttlRemainingInMilliseconds: 30_000 })
    })

    // These pin the script's behaviour, not its prose. The suite mocks `client.eval`, so the script
    // never actually executes here — without these assertions each of the following mutations passes
    // every test while being catastrophically wrong in production: `PEXPIRE` -> `EXPIRE` (a 1000x
    // longer window), swapping the return order (instant permanent 429), dropping the `ttl < 0` guard
    // (the window slides on every hit, defeating the whole point of the primitive), and dropping
    // `and ARGV[2]` (the no-TTL path errors). Real execution is covered by the integration spec that
    // runs when REDIS_URL is set.
    it('should address the script by its digest rather than re-uploading the body', () => {
      expect(evalShaMock).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{40}$/), expect.anything())
      expect(evalMock).not.toHaveBeenCalled()
    })

    it('should increment by the requested amount', () => {
      expect(INCREMENT_SCRIPT).toContain("redis.call('INCRBY', KEYS[1], ARGV[1])")
    })

    it('should expire in milliseconds, not seconds, so the window is not 1000x too long', () => {
      expect(INCREMENT_SCRIPT).toContain("redis.call('PEXPIRE', KEYS[1], ARGV[2])")
      expect(INCREMENT_SCRIPT).not.toMatch(/redis\.call\('EXPIRE'/)
    })

    it('should set the expiry only when the counter has none, so repeated hits cannot slide it', () => {
      expect(INCREMENT_SCRIPT).toContain('if ttl < 0 and ARGV[2] then')
    })

    it('should return the value before the ttl, in that order', () => {
      expect(INCREMENT_SCRIPT).toContain('return { value, ttl }')
    })

    it('should lowercase the key to stay consistent with the other operations', () => {
      expect(evalShaMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ keys: ['rate-limit:bucket'] }))
    })

    it('should pass the amount and the TTL as strings in milliseconds', () => {
      expect(evalShaMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ arguments: ['1', '60000'] })
      )
    })
  })

  describe('and no TTL is given', () => {
    beforeEach(async () => {
      evalShaMock.mockResolvedValue([2, -1])
      await component.increment(counterKey)
    })

    it('should send only the amount so the script leaves the counter without an expiry', () => {
      expect(evalShaMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ arguments: ['1'] }))
    })
  })

  describe('and the counter has no expiry at all', () => {
    let result: { value: number; ttlRemainingInMilliseconds?: number }

    beforeEach(async () => {
      evalShaMock.mockResolvedValue([3, -1])
      result = await component.increment(counterKey)
    })

    it('should report the remaining lifetime as undefined rather than a negative number', () => {
      expect(result).toEqual({ value: 3, ttlRemainingInMilliseconds: undefined })
    })
  })

  describe('and a custom amount is given', () => {
    beforeEach(async () => {
      evalShaMock.mockResolvedValue([10, 1000])
      await component.increment(counterKey, { amount: 5 })
    })

    it('should pass it to the script', () => {
      expect(evalShaMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ arguments: ['5'] }))
    })
  })

  describe('and the TTL is not greater than zero', () => {
    it('should throw rather than let PEXPIRE 0 delete the counter on every hit', async () => {
      await expect(component.increment(counterKey, { ttlInSeconds: 0 })).rejects.toThrow(TypeError)
      expect(evalShaMock).not.toHaveBeenCalled()
    })
  })

  describe('and the amount is not a safe integer', () => {
    it('should throw', async () => {
      await expect(component.increment(counterKey, { amount: 1.5 })).rejects.toThrow(TypeError)
    })
  })

  describe('and Redis fails', () => {
    let error: Error

    beforeEach(() => {
      error = new Error('Redis connection failed')
      evalShaMock.mockRejectedValue(error)
    })

    it('should propagate it and log a fingerprint instead of the raw key', async () => {
      await expect(component.increment(counterKey)).rejects.toThrow(error)
      expect(debugLogMock).toHaveBeenCalledWith(expect.stringMatching(/^Error incrementing key \(fingerprint [0-9a-f]{12}\)$/), error)
    })

    it('should keep the key itself out of the log, since it can hold an IP or a wallet address', async () => {
      await expect(component.increment(counterKey)).rejects.toThrow(error)
      expect(debugLogMock).not.toHaveBeenCalledWith(expect.stringContaining(counterKey), expect.anything())
    })
  })
})

describe('when Redis has not cached the script yet', () => {
  const counterKey = 'noscript-key'
  let noScriptError: Error

  beforeEach(async () => {
    // Redis answers NOSCRIPT on the first call, and again after a restart, a failover or a
    // SCRIPT FLUSH, so the fallback has to hold for the lifetime of the component.
    noScriptError = new Error('NOSCRIPT No matching script. Please use EVAL.')
    evalShaMock.mockRejectedValueOnce(noScriptError)
    evalMock.mockResolvedValue([1, 60_000])
    await component.increment(counterKey, { ttlInSeconds: 60 })
  })

  it('should retry by sending the script body', () => {
    expect(evalMock).toHaveBeenCalledWith(expect.stringContaining("redis.call('INCRBY'"), expect.anything())
  })

  it('should pass the same keys and arguments to the fallback', () => {
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ keys: [counterKey], arguments: ['1', '60000'] })
    )
  })

  it('should not surface the NOSCRIPT failure to the caller', async () => {
    evalShaMock.mockRejectedValueOnce(noScriptError)
    await expect(component.increment(counterKey, { ttlInSeconds: 60 })).resolves.toEqual({
      value: 1,
      ttlRemainingInMilliseconds: 60_000
    })
  })
})

describe('when a Redis operation fails for a reason other than a missing script', () => {
  let failure: Error

  beforeEach(() => {
    failure = new Error('ERR value is not an integer or out of range')
    evalShaMock.mockRejectedValue(failure)
  })

  it('should propagate it rather than retrying with the script body', async () => {
    await expect(component.increment('some-key')).rejects.toThrow(failure)
    expect(evalMock).not.toHaveBeenCalled()
  })
})

describe('when any Redis operation fails', () => {
  beforeEach(async () => {
    getMock.mockRejectedValueOnce(new Error('connection lost'))
    await expect(component.get('a-key')).rejects.toThrow('connection lost')
  })

  it('should report it at debug level only, leaving error level to the caller that receives the throw', () => {
    expect(debugLogMock).toHaveBeenCalled()
    expect(errorLogMock).not.toHaveBeenCalled()
  })
})

describe('when connecting to a Redis URL that carries credentials', () => {
  beforeEach(async () => {
    const withCredentials = await createRedisComponent('redis://someuser:s3cr3t@redis.internal:6379', { logs })
    await withCredentials[START_COMPONENT]!({} as any)
  })

  it('should not write the password to the log', () => {
    const logged = JSON.stringify(debugLogMock.mock.calls)
    expect(logged).not.toContain('s3cr3t')
  })

  it('should not write the username either', () => {
    expect(JSON.stringify(debugLogMock.mock.calls)).not.toContain('someuser')
  })

  it('should still say where it is connecting, so the line stays useful', () => {
    expect(debugLogMock).toHaveBeenCalledWith('Connecting to Redis', {
      hostUrl: expect.stringContaining('redis.internal')
    })
  })
})

describe('when the connection cannot be established at startup', () => {
  let failure: Error

  beforeEach(() => {
    failure = new Error('ECONNREFUSED')
    connectMock.mockRejectedValueOnce(failure)
  })

  it('should report it at error level, unlike the per-operation failures', async () => {
    await expect(component[START_COMPONENT]!({} as any)).rejects.toThrow(failure)
    expect(errorLogMock).toHaveBeenCalledWith('Error connecting to Redis', failure)
  })

  it('should still rethrow, so the caller decides whether to abort the boot', async () => {
    await expect(component[START_COMPONENT]!({} as any)).rejects.toThrow(failure)
  })
})

describe('when the client emits errors before it has ever connected', () => {
  let emitError: (error: Error) => void

  beforeEach(() => {
    // `connect()` does not reject on an unreachable server, it retries, so `start()` stays pending and
    // only this event reports anything at all.
    emitError = mockRedisClient.on.mock.calls.find(([event]: [string]) => event === 'error')[1]
    emitError(new Error('ECONNREFUSED'))
    emitError(new Error('ECONNREFUSED'))
    emitError(new Error('ECONNREFUSED'))
  })

  it('should warn, so a service hanging on an unreachable Redis is not silent', () => {
    expect(debugLogMock).not.toHaveBeenCalledWith(expect.stringContaining('before the first successful'), expect.anything())
    expect(warnLogMock).toHaveBeenCalledWith(
      expect.stringContaining('before the first successful connection'),
      expect.objectContaining({ error: 'ECONNREFUSED' })
    )
  })

  it('should warn only once, since the client emits one error per retry attempt', () => {
    expect(warnLogMock).toHaveBeenCalledTimes(1)
  })

  it('should not put the connection URL credentials in that line', () => {
    expect(JSON.stringify(warnLogMock.mock.calls)).not.toContain('s3cr3t')
  })
})

describe('when the client emits an error after a successful connection', () => {
  beforeEach(async () => {
    await component[START_COMPONENT]!({} as any)
    const emitError = mockRedisClient.on.mock.calls.find(([event]: [string]) => event === 'error')[1]
    emitError(new Error('connection reset'))
  })

  it('should stay at debug, since operations surface their own failures by throwing', () => {
    expect(warnLogMock).not.toHaveBeenCalled()
    expect(debugLogMock).toHaveBeenCalledWith('Redis client error', { error: 'connection reset' })
  })
})
