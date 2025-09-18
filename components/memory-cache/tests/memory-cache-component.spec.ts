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
})

describe('when setting values in a hash', () => {
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

  it('should store the values', async () => {
    const result1 = await component.getFromHash<typeof value1>(hashKey, field1)
    const result2 = await component.getFromHash<typeof value2>(hashKey, field2)

    expect(result1).toEqual(value1)
    expect(result2).toEqual(value2)
  })
})

describe('when setting hash values with TTL', () => {
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

  it('should store the value with TTL', async () => {
    const result = await component.getFromHash<typeof value>(hashKey, field)
    expect(result).toEqual(value)
  })
})

describe('when retrieving all hash fields', () => {
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

  it('should return all hash fields', async () => {
    const allFields = await component.getAllHashFields<typeof value1>(hashKey)

    expect(allFields).toEqual({
      [field1]: value1,
      [field2]: value2
    })
  })
})

describe('when retrieving all fields from a non-existent hash', () => {
  it('should return an empty object', async () => {
    const result = await component.getAllHashFields('non-existent-hash')
    expect(result).toEqual({})
  })
})

describe('when getting a value from hash', () => {
  let hashKey: string
  let field: string
  let value: { id: number; name: string }

  beforeEach(async () => {
    hashKey = 'test-hash'
    field = 'field1'
    value = { id: 1, name: 'value1' }

    await component.setInHash(hashKey, field, value)
  })

  it('should return the stored value', async () => {
    const result = await component.getFromHash<typeof value>(hashKey, field)
    expect(result).toEqual(value)
  })
})

describe('when getting a value from a non-existent hash', () => {
  it('should return null', async () => {
    const result = await component.getFromHash('non-existent-hash', 'field')
    expect(result).toBeNull()
  })
})

describe('when getting a non-existent field from an existing hash', () => {
  let hashKey: string

  beforeEach(async () => {
    hashKey = 'test-hash'
    await component.setInHash(hashKey, 'existing-field', { id: 1, name: 'value' })
  })

  it('should return null', async () => {
    const result = await component.getFromHash(hashKey, 'non-existent-field')
    expect(result).toBeNull()
  })
})

describe('when removing field from hash', () => {
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
    await component.removeFromHash(hashKey, field1)
  })

  it('should remove the specified field', async () => {
    const result1 = await component.getFromHash(hashKey, field1)
    const result2 = await component.getFromHash<typeof value2>(hashKey, field2)

    expect(result1).toBeNull()
    expect(result2).toEqual(value2)
  })
})

describe('when removing from a non-existent hash', () => {
  it('should resolve without throwing an error', async () => {
    await expect(component.removeFromHash('non-existent-hash', 'field')).resolves.not.toThrow()
  })
})

describe('when overwriting hash field values', () => {
  let hashKey: string
  let field: string
  let originalValue: { id: number; name: string }
  let newValue: { id: number; name: string }

  beforeEach(async () => {
    hashKey = 'test-hash'
    field = 'field1'
    originalValue = { id: 1, name: 'original' }
    newValue = { id: 999, name: 'updated' }

    await component.setInHash(hashKey, field, originalValue)
    await component.setInHash(hashKey, field, newValue)
  })

  it('should overwrite the field value', async () => {
    const result = await component.getFromHash<typeof newValue>(hashKey, field)
    expect(result).toEqual(newValue)
  })
})
