import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { LockNotAcquiredError, LockNotReleasedError, sleep } from '@dcl/core-commons'
import { createInMemoryCacheComponent } from '../src/fallback-component'
import { ICacheStorageComponent } from '@dcl/core-commons'

let component: ICacheStorageComponent

beforeEach(() => {
  component = createInMemoryCacheComponent()
})

afterEach(async () => {
  await component[STOP_COMPONENT]?.()
})

describe('when storing and retrieving values', () => {
  const testKey = 'test-key'
  const testValue = { id: 123, name: 'test' }

  describe('and setting a value without TTL', () => {
    beforeEach(async () => {
      await component.set(testKey, testValue)
    })

    it('should store the value', async () => {
      const result = await component.get(testKey)
      expect(result).toEqual(testValue)
    })
  })

  describe('and setting a value with TTL', () => {
    const ttl = 3600

    beforeEach(async () => {
      await component.set(testKey, testValue, ttl)
    })

    it('should store the value with TTL', async () => {
      const result = await component.get(testKey)
      expect(result).toEqual(testValue)
    })
  })

  describe('and getting a value that exists', () => {
    beforeEach(async () => {
      await component.set(testKey, testValue)
    })

    it('should retrieve the value', async () => {
      const result = await component.get(testKey)

      expect(result).toEqual(testValue)
    })
  })

  describe('and getting a value that does not exist', () => {
    it('should return null', async () => {
      const result = await component.get(testKey)

      expect(result).toBeNull()
    })
  })

  describe('and removing a value', () => {
    beforeEach(async () => {
      await component.set(testKey, testValue)
      await component.remove(testKey)
    })

    it('should remove the value', async () => {
      const result = await component.get(testKey)
      expect(result).toBeNull()
    })
  })
})

describe('when getting values by pattern', () => {
  describe('and getting values with wildcard pattern', () => {
    let keys: string[]
    let values: { id: number; name: string }[]

    beforeEach(async () => {
      keys = ['user:123', 'user:456', 'session:abc']
      values = [
        { id: 1, name: 'user1' },
        { id: 2, name: 'user2' },
        { id: 3, name: 'session1' }
      ]

      for (let i = 0; i < keys.length; i++) {
        await component.set(keys[i], values[i])
      }
    })

    it('should return all matching values', async () => {
      const result = await component.getByPattern('user:*')

      expect(result).toHaveLength(2)
      expect(result).toContainEqual(values[0])
      expect(result).toContainEqual(values[1])
      expect(result).not.toContainEqual(values[2])
    })
  })

  describe('and getting a value with exact key', () => {
    const testKey = 'exact-key'
    const testValue = { id: 123, name: 'test' }

    beforeEach(async () => {
      await component.set(testKey, testValue)
    })

    it('should return the value as an array', async () => {
      const result = await component.getByPattern(testKey)

      expect(result).toEqual([testValue])
    })
  })

  describe('and getting a value that does not exist', () => {
    it('should return an empty array', async () => {
      const result = await component.getByPattern('non-existent-key')

      expect(result).toEqual([])
    })
  })
})

describe('when scanning keys', () => {
  describe('and scanning with default pattern', () => {
    let keys: string[]

    beforeEach(async () => {
      keys = ['key1', 'key2', 'key3']
      for (const key of keys) {
        await component.set(key, 'value')
      }
    })

    it('should return all keys', async () => {
      const result = await component.keys()

      keys.forEach((key) => {
        expect(result).toContain(key)
      })
    })
  })

  describe('and scanning with custom pattern', () => {
    const pattern = 'user:*'
    let matchingKeys: string[]
    let nonMatchingKeys: string[]

    beforeEach(async () => {
      matchingKeys = ['user:123', 'user:456']
      nonMatchingKeys = ['session:abc', 'other:def']

      for (const key of [...matchingKeys, ...nonMatchingKeys]) {
        await component.set(key, 'value')
      }
    })

    it('should return only matching keys', async () => {
      const result = await component.keys(pattern)

      matchingKeys.forEach((key) => {
        expect(result).toContain(key)
      })
      nonMatchingKeys.forEach((key) => {
        expect(result).not.toContain(key)
      })
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

  it('should store the value in the hash', async () => {
    const result = await component.getFromHash<typeof value>(hashKey, field)
    expect(result).toEqual(value)
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

  it('should store the value in the hash', async () => {
    const result = await component.getFromHash<typeof value>(hashKey, field)
    expect(result).toEqual(value)
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

  it('should store the value in the hash', async () => {
    const result = await component.getFromHash<typeof value>(hashKey, field)
    expect(result).toEqual(value)
  })
})

describe('when getting a value from a hash that exists', () => {
  let hashKey: string
  let field: string
  let value: { id: number; name: string }

  beforeEach(async () => {
    hashKey = 'test-hash'
    field = 'field1'
    value = { id: 1, name: 'value1' }

    await component.setInHash(hashKey, field, value)
  })

  it('should retrieve the hash field value', async () => {
    const result = await component.getFromHash(hashKey, field)

    expect(result).toEqual(value)
  })
})

describe('when getting a value from hash that does not exist', () => {
  let hashKey: string
  let field: string

  beforeEach(() => {
    hashKey = 'test-hash'
    field = 'field1'
  })

  it('should return null', async () => {
    const result = await component.getFromHash(hashKey, field)

    expect(result).toBeNull()
  })
})

describe('when removing a field from a hash', () => {
  let hashKey: string
  let field: string

  beforeEach(async () => {
    hashKey = 'test-hash'
    field = 'field1'

    await component.setInHash(hashKey, field, { id: 1, name: 'value1' })
    await component.removeFromHash(hashKey, field)
  })

  it('should remove the field from the hash', async () => {
    const result = await component.getFromHash(hashKey, field)
    expect(result).toBeNull()
  })
})

describe('when getting all hash fields', () => {
  let hashKey: string
  let field1: string
  let field2: string
  let value1: { id: number; name: string }
  let value2: { id: number; name: string }

  beforeEach(async () => {
    hashKey = 'test-hash'
    field1 = 'field1'
    field2 = 'field2'
    value1 = { id: 1, name: 'value1' }
    value2 = { id: 2, name: 'value2' }

    await component.setInHash(hashKey, field1, value1)
    await component.setInHash(hashKey, field2, value2)
  })

  it('should retrieve and deserialize all hash fields', async () => {
    const result = await component.getAllHashFields(hashKey)

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
  })

  it('should return an empty object', async () => {
    const result = await component.getAllHashFields(hashKey)

    expect(result).toEqual({})
  })
})

describe('when acquiring locks', () => {
  const lockKey = 'test-lock'

  describe('and the lock is successfully acquired on first try', () => {
    it('should acquire the lock with custom retry options', async () => {
      await component.acquireLock(lockKey, {
        ttlInMilliseconds: 5000,
        retryDelayInMilliseconds: 100,
        retries: 5
      })

      // Verify lock is acquired by trying to release it
      await expect(component.releaseLock(lockKey)).resolves.not.toThrow()
    })
  })

  describe('and the lock is acquired after retries', () => {
    let otherComponent: ICacheStorageComponent

    beforeEach(async () => {
      otherComponent = createInMemoryCacheComponent()
      await otherComponent.acquireLock(lockKey, { ttlInMilliseconds: 50 })
      // Wait for lock to expire
      await sleep(60)
    })

    afterEach(async () => {
      await otherComponent[STOP_COMPONENT]?.()
    })

    it('should retry and eventually acquire the lock', async () => {
      const retryDelay = 50
      const retries = 5

      await component.acquireLock(lockKey, {
        retryDelayInMilliseconds: retryDelay,
        retries
      })

      // Verify lock is acquired
      await expect(component.releaseLock(lockKey)).resolves.not.toThrow()
    })
  })

  describe('and the lock cannot be acquired after all retries', () => {
    beforeEach(async () => {
      // In in-memory cache, each instance has its own lock storage
      // So we need to acquire the lock in the same instance to test retry behavior
      await component.acquireLock(lockKey, { ttlInMilliseconds: 10000 })
    })

    it('should throw LockNotAcquiredError after exhausting retries', async () => {
      const retries = 3

      await expect(component.acquireLock(lockKey, { retries })).rejects.toThrow(LockNotAcquiredError)
    })
  })
})

describe('when releasing locks', () => {
  const lockKey = 'test-lock'

  describe('and the lock is successfully released', () => {
    beforeEach(async () => {
      await component.acquireLock(lockKey)
    })

    it('should release the lock successfully', async () => {
      await component.releaseLock(lockKey)

      // Verify lock is released by trying to acquire it again
      await expect(component.acquireLock(lockKey)).resolves.not.toThrow()
    })
  })

  describe('and the lock is not owned by this instance', () => {
    it('should throw LockNotReleasedError when lock does not exist', async () => {
      // In in-memory cache, each instance has its own lock storage
      // So a lock that doesn't exist in this instance will throw an error
      await expect(component.releaseLock(lockKey)).rejects.toThrow(LockNotReleasedError)
    })
  })

})

describe('when trying to acquire locks', () => {
  const lockKey = 'test-lock'

  describe('and the lock is successfully acquired', () => {
    it('should return true', async () => {
      const result = await component.tryAcquireLock(lockKey)

      expect(result).toBe(true)
      // Verify lock is acquired
      await expect(component.releaseLock(lockKey)).resolves.not.toThrow()
    })

    it('should return true with custom options', async () => {
      const result = await component.tryAcquireLock(lockKey, {
        ttlInMilliseconds: 5000,
        retries: 2
      })

      expect(result).toBe(true)
      await expect(component.releaseLock(lockKey)).resolves.not.toThrow()
    })
  })

  describe('and the lock cannot be acquired', () => {
    beforeEach(async () => {
      // In in-memory cache, each instance has its own lock storage
      // So we need to acquire the lock in the same instance to test retry behavior
      await component.acquireLock(lockKey, { ttlInMilliseconds: 10000 })
    })

    it('should return false after exhausting retries', async () => {
      const result = await component.tryAcquireLock(lockKey, { retries: 2 })

      expect(result).toBe(false)
    })
  })

  describe('and there is an error', () => {
    beforeEach(async () => {
      // In in-memory cache, each instance has its own lock storage
      // So we need to acquire the lock in the same instance to test retry behavior
      await component.acquireLock(lockKey, { ttlInMilliseconds: 10000 })
    })

    it('should return false when lock cannot be acquired', async () => {
      // This test verifies that tryAcquireLock doesn't throw
      // even when the lock is held in the same instance
      const result = await component.tryAcquireLock(lockKey, { retries: 1 })

      expect(result).toBe(false)
    })
  })
})

describe('when trying to release locks', () => {
  const lockKey = 'test-lock'

  describe('and the lock is successfully released', () => {
    beforeEach(async () => {
      await component.acquireLock(lockKey)
    })

    it('should return true', async () => {
      const result = await component.tryReleaseLock(lockKey)

      expect(result).toBe(true)
    })
  })

  describe('and the lock is not owned by this instance', () => {
    it('should return false when lock does not exist', async () => {
      // In in-memory cache, each instance has its own lock storage
      // So a lock that doesn't exist in this instance will return false
      const result = await component.tryReleaseLock(lockKey)

      expect(result).toBe(false)
    })
  })

})

