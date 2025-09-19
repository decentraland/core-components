import { ILoggerComponent } from '@well-known-components/interfaces'
import { createLoggerMockedComponent } from '@dcl/core-commons'
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
let quitMock: jest.Mock
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
let errorLogMock: jest.Mock
let debugLogMock: jest.Mock

const hostUrl = 'redis://localhost:6379'

beforeEach(async () => {
  connectMock = jest.fn().mockResolvedValue(undefined)
  quitMock = jest.fn().mockResolvedValue(undefined)
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
  multiMock = jest.fn().mockReturnValue({
    hSet: hSetMock,
    expire: expireMock,
    exec: execMock
  })
  errorLogMock = jest.fn()
  debugLogMock = jest.fn()

  mockRedisClient = {
    connect: connectMock,
    quit: quitMock,
    get: getMock,
    set: setMock,
    del: delMock,
    scan: scanMock,
    hSet: hSetMock,
    hGet: hGetMock,
    hDel: hDelMock,
    hGetAll: hGetAllMock,
    multi: multiMock,
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
      expect(debugLogMock).toHaveBeenCalledWith(`Successfully set key "${testKey}"`)
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
      expect(debugLogMock).toHaveBeenCalledWith(`Successfully removed key "${testKey}"`)
    })
  })
})

describe('when scanning keys', () => {
  describe('and scanning with default pattern', () => {
    beforeEach(() => {
      scanMock
        .mockResolvedValueOnce({ cursor: 5, keys: ['key1', 'key2'] })
        .mockResolvedValueOnce({ cursor: 0, keys: ['key3'] })
    })

    it('should return all keys from multiple scan iterations', async () => {
      const keys = await component.keys()

      expect(scanMock).toHaveBeenCalledWith(0, { MATCH: '*', COUNT: 100 })
      expect(scanMock).toHaveBeenCalledWith(5, { MATCH: '*', COUNT: 100 })
      expect(keys).toEqual(['key1', 'key2', 'key3'])
    })
  })

  describe('and scanning with custom pattern', () => {
    const pattern = 'user:*'

    beforeEach(() => {
      scanMock.mockResolvedValue({ cursor: 0, keys: ['user:123', 'user:456'] })
    })

    it('should use the provided pattern', async () => {
      const keys = await component.keys(pattern)

      expect(scanMock).toHaveBeenCalledWith(0, { MATCH: pattern, COUNT: 100 })
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
