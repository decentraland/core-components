import { IConfigComponent } from '@well-known-components/interfaces'
import { createConfigMockedComponent } from '@dcl/core-commons'
import { createS3Component } from '../src/component'
import { IS3Component } from '../src/types'

// Helper to create mock commands
const createMockCommand = (params: any) => ({ input: params })

// Mock the AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn().mockImplementation(createMockCommand),
  GetObjectCommand: jest.fn().mockImplementation(createMockCommand),
  DeleteObjectCommand: jest.fn().mockImplementation(createMockCommand),
  ListObjectsV2Command: jest.fn().mockImplementation(createMockCommand),
  HeadObjectCommand: jest.fn().mockImplementation(createMockCommand),
  NoSuchKey: class NoSuchKey extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'NoSuchKey'
    }
  },
  NotFound: class NotFound extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'NotFound'
    }
  }
}))

let config: IConfigComponent
let component: IS3Component
let mockS3Client: any
let sendMock: jest.Mock
let bucketName: string
let s3Endpoint: string

beforeEach(async () => {
  bucketName = 'test-bucket'
  s3Endpoint = 'http://localhost:4566'
  sendMock = jest.fn()

  mockS3Client = {
    send: sendMock
  }

  const { S3Client } = require('@aws-sdk/client-s3')
  S3Client.mockImplementation(() => mockS3Client)

  config = createConfigMockedComponent({
    requireString: jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'AWS_S3_BUCKET_NAME':
          return bucketName
        default:
          throw new Error(`Unknown key: ${key}`)
      }
    }),
    getString: jest.fn().mockImplementation((key: string) => {
      switch (key) {
        case 'AWS_S3_ENDPOINT':
          return s3Endpoint
        case 'AWS_REGION':
          return 'us-east-1'
        default:
          return undefined
      }
    })
  })

  component = await createS3Component({ config })
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('when uploading objects', () => {
  const key = 'test/file.txt'
  const body = 'test content'
  const contentType = 'text/plain'

  describe('and the upload succeeds', () => {
    it('should return ETag from S3', async () => {
      sendMock.mockResolvedValueOnce({
        ETag: '"abc123"'
      })


      const result = await component.uploadObject(key, body, contentType)

      expect(result.ETag).toEqual('"abc123"')
      expect(sendMock).toHaveBeenCalledTimes(1)
      
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key,
        Body: body,
        ContentType: contentType
      })
    })
  })

  describe('and the upload fails', () => {
    it('should throw error with failure message', async () => {
      sendMock.mockRejectedValueOnce(new Error('S3 upload failed'))


      await expect(component.uploadObject(key, body, contentType)).rejects.toThrow('S3 upload failed')
    })
  })
})

describe('when downloading objects', () => {
  const key = 'test/file.txt'
  const content = 'test content'

  describe('and the object exists', () => {
    it('should return object content as string', async () => {
      sendMock.mockResolvedValueOnce({
        Body: {
          transformToString: jest.fn().mockResolvedValue(content)
        }
      })


      const result = await component.downloadObject(key)

      expect(result).toEqual(content)
      expect(sendMock).toHaveBeenCalledTimes(1)
      
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and the object does not exist', () => {
    it('should return null', async () => {
      const { NoSuchKey } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NoSuchKey('The specified key does not exist'))


      const result = await component.downloadObject(key)

      expect(result).toBeNull()
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the object has no body', () => {
    it('should return null', async () => {
      sendMock.mockResolvedValueOnce({
        Body: null
      })


      const result = await component.downloadObject(key)

      expect(result).toBeNull()
    })
  })

  describe('and there is an S3 error', () => {
    it('should throw error with failure message', async () => {
      sendMock.mockRejectedValueOnce(new Error('S3 connection error'))

      await expect(component.downloadObject(key)).rejects.toThrow('S3 connection error')
    })
  })
})

describe('when deleting objects', () => {
  const key = 'test/file.txt'

  describe('and the delete succeeds', () => {
    it('should complete without throwing', async () => {
      sendMock.mockResolvedValueOnce({})


      await expect(component.deleteObject(key)).resolves.not.toThrow()
      expect(sendMock).toHaveBeenCalledTimes(1)
      
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and the delete fails', () => {
    it('should throw error with failure message', async () => {
      sendMock.mockRejectedValueOnce(new Error('S3 delete failed'))


      await expect(component.deleteObject(key)).rejects.toThrow('S3 delete failed')
    })
  })
})

describe('when listing objects', () => {
  describe('and objects exist', () => {
    it('should return array of all object keys', async () => {
      sendMock.mockResolvedValueOnce({
        Contents: [{ Key: 'test/file1.txt' }, { Key: 'test/file2.txt' }, { Key: 'test/file3.txt' }]
      })


      const result = await component.listObjects()

      expect(result).toEqual(['test/file1.txt', 'test/file2.txt', 'test/file3.txt'])
      expect(sendMock).toHaveBeenCalledTimes(1)
      
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Prefix: undefined,
        MaxKeys: 1000
      })
    })
  })

  describe('and listing with prefix', () => {
    it('should return array of keys matching prefix', async () => {
      sendMock.mockResolvedValueOnce({
        Contents: [{ Key: 'test/file1.txt' }, { Key: 'test/file2.txt' }]
      })


      const result = await component.listObjects('test/')

      expect(result).toEqual(['test/file1.txt', 'test/file2.txt'])
      expect(sendMock).toHaveBeenCalledTimes(1)
      
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Prefix: 'test/',
        MaxKeys: 1000
      })
    })
  })

  describe('and listing with max keys', () => {
    it('should return array limited by max keys parameter', async () => {
      sendMock.mockResolvedValueOnce({
        Contents: [{ Key: 'test/file1.txt' }]
      })


      const result = await component.listObjects('test/', 10)

      expect(result).toEqual(['test/file1.txt'])
      expect(sendMock).toHaveBeenCalledTimes(1)
      
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Prefix: 'test/',
        MaxKeys: 10
      })
    })
  })

  describe('and no objects exist', () => {
    it('should return empty array', async () => {
      sendMock.mockResolvedValueOnce({
        Contents: []
      })


      const result = await component.listObjects()

      expect(result).toEqual([])
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and Contents is undefined', () => {
    it('should return empty array', async () => {
      sendMock.mockResolvedValueOnce({})


      const result = await component.listObjects()

      expect(result).toEqual([])
    })
  })
})

describe('when getting object metadata', () => {
  const key = 'test/file.txt'
  let s3Metadata: any
  let expectedMetadata: any

  beforeEach(() => {
    s3Metadata = {
      ContentLength: 1024,
      ContentType: 'text/plain',
      LastModified: new Date('2024-01-01'),
      ETag: '"abc123"'
    }
    expectedMetadata = {
      contentLength: 1024,
      contentType: 'text/plain',
      lastModified: new Date('2024-01-01'),
      eTag: '"abc123"'
    }
  })

  describe('and the object exists', () => {
    it('should return metadata with content length, type, date, and ETag', async () => {
      sendMock.mockResolvedValueOnce(s3Metadata)


      const result = await component.getObjectMetadata(key)

      expect(result).toEqual(expectedMetadata)
      expect(sendMock).toHaveBeenCalledTimes(1)
      
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and the object does not exist', () => {
    it('should return null', async () => {
      const { NotFound } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NotFound('Not Found'))


      const result = await component.getObjectMetadata(key)

      expect(result).toBeNull()
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and there is an S3 error', () => {
    it('should throw error with failure message', async () => {
      sendMock.mockRejectedValueOnce(new Error('S3 connection error'))

      await expect(component.getObjectMetadata(key)).rejects.toThrow('S3 connection error')
    })
  })
})

describe('when checking if object exists', () => {
  const key = 'test/file.txt'

  describe('and the object exists', () => {
    it('should return true', async () => {
      sendMock.mockResolvedValueOnce({
        ContentLength: 1024,
        ContentType: 'text/plain'
      })


      const result = await component.objectExists(key)

      expect(result).toBe(true)
      expect(sendMock).toHaveBeenCalledTimes(1)
      
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and the object does not exist', () => {
    it('should return false', async () => {
      const { NotFound } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NotFound('Not Found'))


      const result = await component.objectExists(key)

      expect(result).toBe(false)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })
})

describe('when checking if multiple objects exist', () => {
  let keys: string[]

  beforeEach(() => {
    keys = ['test/file1.txt', 'test/file2.txt', 'test/file3.txt']
  })

  describe('and all objects exist', () => {
    it('should return all keys with true values', async () => {
      sendMock.mockResolvedValue({
        ContentLength: 1024,
        ContentType: 'text/plain'
      })


      const result = await component.multipleObjectsExist(keys)

      expect(result).toEqual({
        'test/file1.txt': true,
        'test/file2.txt': true,
        'test/file3.txt': true
      })
      expect(sendMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('and some objects exist', () => {
    it('should return mixed existence results', async () => {
      const { NotFound } = require('@aws-sdk/client-s3')
      sendMock.mockImplementation((command: any) => {
        const key = command.input.Key
        if (key === 'test/file1.txt' || key === 'test/file3.txt') {
          return Promise.resolve({
            ContentLength: 1024,
            ContentType: 'text/plain'
          })
        }
        return Promise.reject(new NotFound('Not Found'))
      })


      const result = await component.multipleObjectsExist(keys)

      expect(result).toEqual({
        'test/file1.txt': true,
        'test/file2.txt': false,
        'test/file3.txt': true
      })
      expect(sendMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('and no objects exist', () => {
    it('should return all keys with false values', async () => {
      const { NotFound } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValue(new NotFound('Not Found'))


      const result = await component.multipleObjectsExist(keys)

      expect(result).toEqual({
        'test/file1.txt': false,
        'test/file2.txt': false,
        'test/file3.txt': false
      })
      expect(sendMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('and empty array is provided', () => {
    it('should return empty object', async () => {
      const result = await component.multipleObjectsExist([])

      expect(result).toEqual({})
      expect(sendMock).not.toHaveBeenCalled()
    })
  })
})
