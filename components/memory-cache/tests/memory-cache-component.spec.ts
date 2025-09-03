import { createInMemoryCacheComponent } from '../src/component'
import { ICacheStorageComponent } from '../src/types'

let component: ICacheStorageComponent

beforeEach(() => {
  component = createInMemoryCacheComponent()
})

describe('when storing and retrieving values', () => {
  const testKey = 'test-key'
  const testValue = { id: 123, name: 'test' }

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
  const keys = ['user:123', 'user:456', 'session:abc', 'session:def']
  const values = ['value1', 'value2', 'value3', 'value4']

  beforeEach(async () => {
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
  it('should handle strings', async () => {
    const value = 'test string'
    await component.set('string-key', value)

    const result = await component.get('string-key')
    expect(result).toBe(value)
  })

  it('should handle numbers', async () => {
    const value = 42
    await component.set('number-key', value)

    const result = await component.get('number-key')
    expect(result).toBe(value)
  })

  it('should handle objects', async () => {
    const value = { id: 1, name: 'test', active: true }
    await component.set('object-key', value)

    const result = await component.get('object-key')
    expect(result).toEqual(value)
  })

  it('should handle arrays', async () => {
    const value = [1, 'two', { three: 3 }]
    await component.set('array-key', value)

    const result = await component.get('array-key')
    expect(result).toEqual(value)
  })

  it('should handle null values', async () => {
    await component.set('null-key', null)
    const nullResult = await component.get('null-key')
    expect(nullResult).toBeNull()
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

  it('should handle multiple concurrent operations', async () => {
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

  it('should clear cache on stop', async () => {
    const testKey = 'test-key'
    const testValue = 'test-value'

    await component.set(testKey, testValue)

    // Verify value is stored
    let retrieved = await component.get(testKey)
    expect(retrieved).toBe(testValue)

    // Stop component should clear cache
    if (component.stop) {
      await component.stop()
    }

    // Value should be cleared (if stop was called)
    retrieved = await component.get(testKey)
    if (component.stop) {
      expect(retrieved).toBeNull()
    } else {
      expect(retrieved).toBe(testValue)
    }
  })
})
