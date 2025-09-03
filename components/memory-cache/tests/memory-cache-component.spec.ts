import { createInMemoryCacheComponent } from '../src/component'
import { ICacheStorageComponent } from '@dcl/core-commons'

let component: ICacheStorageComponent

beforeEach(() => {
  component = createInMemoryCacheComponent()
})

describe('when storing and retrieving values', () => {
  let testKey: string
  let testValue: { id: number; name: string }

  beforeEach(() => {
    testKey = 'test-key'
    testValue = { id: 123, name: 'test' }
  })

  describe('and setting a value without TTL', () => {
    beforeEach(async () => {
      await component.set(testKey, testValue)
    })

    it('should store the value', async () => {
      const result = await component.get<typeof testValue>(testKey)
      expect(result).toEqual(testValue)
    })
  })

  describe('and setting a value with TTL', () => {
    const ttl = 3600

    beforeEach(async () => {
      await component.set(testKey, testValue, ttl)
    })

    it('should store the value with TTL', async () => {
      const result = await component.get<typeof testValue>(testKey)
      expect(result).toEqual(testValue)
    })
  })

  describe('and getting a value that does not exist', () => {
    it('should return null', async () => {
      const result = await component.get('non-existent-key')
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

describe('when scanning keys', () => {
  let keys: string[]
  let values: string[]

  beforeEach(async () => {
    keys = ['user:123', 'user:456', 'session:abc', 'session:def']
    values = ['value1', 'value2', 'value3', 'value4']
    for (let i = 0; i < keys.length; i++) {
      await component.set(keys[i], values[i])
    }
  })

  describe('and scanning with default pattern', () => {
    it('should return all keys', async () => {
      const result = await component.keys()

      // Should contain all stored keys
      keys.forEach((key) => {
        expect(result).toContain(key)
      })
    })
  })

  describe('and scanning with pattern', () => {
    it('should return matching keys for user pattern', async () => {
      const result = await component.keys('user:*')

      expect(result).toContain('user:123')
      expect(result).toContain('user:456')
      expect(result).not.toContain('session:abc')
      expect(result).not.toContain('session:def')
    })

    it('should return matching keys for session pattern', async () => {
      const result = await component.keys('session:*')

      expect(result).toContain('session:abc')
      expect(result).toContain('session:def')
      expect(result).not.toContain('user:123')
      expect(result).not.toContain('user:456')
    })

    it('should return empty array for non-matching pattern', async () => {
      const result = await component.keys('nonexistent:*')
      expect(result).toHaveLength(0)
    })
  })
})

describe('when handling different data types', () => {
  describe('and storing string values', () => {
    let value: string
    
    beforeEach(async () => {
      value = 'test string'
      await component.set('string-key', value)
    })

    it('should retrieve the string value', async () => {
      const result = await component.get('string-key')
      expect(result).toBe(value)
    })
  })

  describe('and storing number values', () => {
    let value: number
    
    beforeEach(async () => {
      value = 42
      await component.set('number-key', value)
    })

    it('should retrieve the number value', async () => {
      const result = await component.get('number-key')
      expect(result).toBe(value)
    })
  })

  describe('and storing object values', () => {
    let value: { id: number; name: string; active: boolean }
    
    beforeEach(async () => {
      value = { id: 1, name: 'test', active: true }
      await component.set('object-key', value)
    })

    it('should retrieve the object value', async () => {
      const result = await component.get('object-key')
      expect(result).toEqual(value)
    })
  })

  describe('and storing array values', () => {
    let value: (number | string | object)[]
    
    beforeEach(async () => {
      value = [1, 'two', { three: 3 }]
      await component.set('array-key', value)
    })

    it('should retrieve the array value', async () => {
      const result = await component.get('array-key')
      expect(result).toEqual(value)
    })
  })

  describe('and storing null values', () => {
    beforeEach(async () => {
      await component.set('null-key', null)
    })

    it('should retrieve null', async () => {
      const result = await component.get('null-key')
      expect(result).toBeNull()
    })
  })
})

describe('when handling cache operations', () => {
  it('should overwrite existing values', async () => {
    const key = 'overwrite-key'
    const firstValue = 'first'
    const secondValue = 'second'

    await component.set(key, firstValue)
    let result = await component.get(key)
    expect(result).toBe(firstValue)

    await component.set(key, secondValue)
    result = await component.get(key)
    expect(result).toBe(secondValue)
  })

  it('should handle multiple concurrent operations without data corruption', async () => {
    // This test verifies that the cache can handle multiple concurrent set operations
    // without data corruption or race conditions
    const operations = []

    for (let i = 0; i < 10; i++) {
      operations.push(component.set(`concurrent-key-${i}`, `value-${i}`))
    }

    await Promise.all(operations)

    for (let i = 0; i < 10; i++) {
      const result = await component.get(`concurrent-key-${i}`)
      expect(result).toBe(`value-${i}`)
    }
  })
})
