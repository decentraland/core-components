import { ILoggerComponent } from '@well-known-components/interfaces'
import { createLoggerMockedComponent } from '@dcl/core-commons'
import { createRedisComponent } from '../src/component'
import { ICacheStorageComponent } from '../src/types'

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
  errorLogMock = jest.fn()
  debugLogMock = jest.fn()

  mockRedisClient = {
    connect: connectMock,
    quit: quitMock,
    get: getMock,
    set: setMock,
    del: delMock,
    scan: scanMock,
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

describe('when handling different data types', () => {
  it('should handle strings', async () => {
    const value = 'test string'
    await component.set('string-key', value)
    const serialized = JSON.stringify(value)
    expect(setMock).toHaveBeenCalledWith('string-key', serialized, { EX: undefined })
  })

  it('should handle numbers', async () => {
    const value = 42
    await component.set('number-key', value)
    const serialized = JSON.stringify(value)
    expect(setMock).toHaveBeenCalledWith('number-key', serialized, { EX: undefined })
  })

  it('should handle objects', async () => {
    const value = { id: 1, name: 'test', active: true }
    await component.set('object-key', value)
    const serialized = JSON.stringify(value)
    expect(setMock).toHaveBeenCalledWith('object-key', serialized, { EX: undefined })
  })

  it('should handle arrays', async () => {
    const value = [1, 'two', { three: 3 }]
    await component.set('array-key', value)
    const serialized = JSON.stringify(value)
    expect(setMock).toHaveBeenCalledWith('array-key', serialized, { EX: undefined })
  })
})
