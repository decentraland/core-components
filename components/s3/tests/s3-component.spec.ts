import { IConfigComponent } from '@well-known-components/interfaces'
import { createConfigMockedComponent } from '@dcl/core-commons'
import { createS3Component } from '../src/component'
import { IS3Component } from '../src/types'

// Mock the AWS SDK
jest.mock('@aws-sdk/client-s3', () => {
  const createMockCommand = (params: any) => ({ input: params })

  return {
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
  }
})

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
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        ETag: '"abc123"'
      })
    })

    it('should return ETag from S3', async () => {
      const result = await component.uploadObject(key, body, contentType)

      expect(result.ETag).toEqual('"abc123"')
    })

    it('should send PutObjectCommand with correct bucket, key, body, and content type', async () => {
      await component.uploadObject(key, body, contentType)

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
    beforeEach(() => {
      sendMock.mockRejectedValueOnce(new Error('S3 upload failed'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.uploadObject(key, body, contentType)).rejects.toThrow('S3 upload failed')
    })

    it('should send PutObjectCommand with correct parameters before failing', async () => {
      await expect(component.uploadObject(key, body, contentType)).rejects.toThrow()

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
})

describe('when downloading objects', () => {
  const key = 'test/file.txt'
  const content = 'test content'

  describe('and the object exists', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Body: {
          transformToString: jest.fn().mockResolvedValue(content)
        }
      })
    })

    it('should return object content as string', async () => {
      const result = await component.downloadObject(key)

      expect(result).toEqual(content)
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObject(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const { NoSuchKey } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NoSuchKey('The specified key does not exist'))
    })

    it('should return null', async () => {
      const result = await component.downloadObject(key)

      expect(result).toBeNull()
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObject(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and the object has no body', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Body: null
      })
    })

    it('should return null', async () => {
      const result = await component.downloadObject(key)

      expect(result).toBeNull()
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObject(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and there is an S3 error', () => {
    beforeEach(() => {
      sendMock.mockRejectedValueOnce(new Error('S3 connection error'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.downloadObject(key)).rejects.toThrow('S3 connection error')
    })

    it('should send GetObjectCommand with correct bucket and key before failing', async () => {
      await expect(component.downloadObject(key)).rejects.toThrow()

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })
})

describe('when deleting objects', () => {
  const key = 'test/file.txt'

  describe('and the delete succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({})
    })

    it('should complete without throwing', async () => {
      await expect(component.deleteObject(key)).resolves.not.toThrow()
    })

    it('should send DeleteObjectCommand with correct bucket and key', async () => {
      await component.deleteObject(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and the delete fails', () => {
    beforeEach(() => {
      sendMock.mockRejectedValueOnce(new Error('S3 delete failed'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.deleteObject(key)).rejects.toThrow('S3 delete failed')
    })

    it('should send DeleteObjectCommand with correct bucket and key before failing', async () => {
      await expect(component.deleteObject(key)).rejects.toThrow()

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })
})

describe('when listing objects', () => {
  describe('and objects exist', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Contents: [{ Key: 'test/file1.txt' }, { Key: 'test/file2.txt' }, { Key: 'test/file3.txt' }]
      })
    })

    it('should return array of all object keys', async () => {
      const result = await component.listObjects()

      expect(result).toEqual(['test/file1.txt', 'test/file2.txt', 'test/file3.txt'])
    })

    it('should send ListObjectsV2Command with correct bucket and default parameters', async () => {
      await component.listObjects()

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
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Contents: [{ Key: 'test/file1.txt' }, { Key: 'test/file2.txt' }]
      })
    })

    it('should return array of keys matching prefix', async () => {
      const result = await component.listObjects('test/')

      expect(result).toEqual(['test/file1.txt', 'test/file2.txt'])
    })

    it('should send ListObjectsV2Command with correct bucket and prefix', async () => {
      await component.listObjects('test/')

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
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Contents: [{ Key: 'test/file1.txt' }]
      })
    })

    it('should return array limited by max keys parameter', async () => {
      const result = await component.listObjects('test/', 10)

      expect(result).toEqual(['test/file1.txt'])
    })

    it('should send ListObjectsV2Command with correct bucket, prefix, and maxKeys', async () => {
      await component.listObjects('test/', 10)

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
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Contents: []
      })
    })

    it('should return empty array', async () => {
      const result = await component.listObjects()

      expect(result).toEqual([])
    })

    it('should send ListObjectsV2Command with correct bucket and default parameters', async () => {
      await component.listObjects()

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Prefix: undefined,
        MaxKeys: 1000
      })
    })
  })

  describe('and Contents is undefined', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({})
    })

    it('should return empty array', async () => {
      const result = await component.listObjects()

      expect(result).toEqual([])
    })

    it('should send ListObjectsV2Command with correct bucket and default parameters', async () => {
      await component.listObjects()

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Prefix: undefined,
        MaxKeys: 1000
      })
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
    beforeEach(() => {
      sendMock.mockResolvedValueOnce(s3Metadata)
    })

    it('should return metadata with content length, type, date, and ETag', async () => {
      const result = await component.getObjectMetadata(key)

      expect(result).toEqual(expectedMetadata)
    })

    it('should send HeadObjectCommand with correct bucket and key', async () => {
      await component.getObjectMetadata(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const { NotFound } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NotFound('Not Found'))
    })

    it('should return null', async () => {
      const result = await component.getObjectMetadata(key)

      expect(result).toBeNull()
    })

    it('should send HeadObjectCommand with correct bucket and key', async () => {
      await component.getObjectMetadata(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and there is an S3 error', () => {
    beforeEach(() => {
      sendMock.mockRejectedValueOnce(new Error('S3 connection error'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.getObjectMetadata(key)).rejects.toThrow('S3 connection error')
    })

    it('should send HeadObjectCommand with correct bucket and key before failing', async () => {
      await expect(component.getObjectMetadata(key)).rejects.toThrow()

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })
})

describe('when checking if object exists', () => {
  const key = 'test/file.txt'

  describe('and the object exists', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        ContentLength: 1024,
        ContentType: 'text/plain'
      })
    })

    it('should return true', async () => {
      const result = await component.objectExists(key)

      expect(result).toBe(true)
    })

    it('should send HeadObjectCommand with correct bucket and key', async () => {
      await component.objectExists(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const { NotFound } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NotFound('Not Found'))
    })

    it('should return false', async () => {
      const result = await component.objectExists(key)

      expect(result).toBe(false)
    })

    it('should send HeadObjectCommand with correct bucket and key', async () => {
      await component.objectExists(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual({
        Bucket: bucketName,
        Key: key
      })
    })
  })
})

describe('when checking if multiple objects exist', () => {
  let keys: string[]

  beforeEach(() => {
    keys = ['test/file1.txt', 'test/file2.txt', 'test/file3.txt']
  })

  describe('and all objects exist', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        ContentLength: 1024,
        ContentType: 'text/plain'
      })
    })

    it('should return all keys with true values', async () => {
      const result = await component.multipleObjectsExist(keys)

      expect(result).toEqual({
        'test/file1.txt': true,
        'test/file2.txt': true,
        'test/file3.txt': true
      })
    })

    it('should send HeadObjectCommand for each key with correct bucket and key', async () => {
      await component.multipleObjectsExist(keys)

      expect(sendMock).toHaveBeenCalledTimes(3)
      keys.forEach((key, index) => {
        const command = sendMock.mock.calls[index][0]
        expect(command.input).toEqual({
          Bucket: bucketName,
          Key: key
        })
      })
    })
  })

  describe('and some objects exist', () => {
    beforeEach(() => {
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
    })

    it('should return mixed existence results', async () => {
      const result = await component.multipleObjectsExist(keys)

      expect(result).toEqual({
        'test/file1.txt': true,
        'test/file2.txt': false,
        'test/file3.txt': true
      })
    })

    it('should send HeadObjectCommand for each key with correct bucket and key', async () => {
      await component.multipleObjectsExist(keys)

      expect(sendMock).toHaveBeenCalledTimes(3)
      keys.forEach((key, index) => {
        const command = sendMock.mock.calls[index][0]
        expect(command.input).toEqual({
          Bucket: bucketName,
          Key: key
        })
      })
    })
  })

  describe('and no objects exist', () => {
    beforeEach(() => {
      const { NotFound } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValue(new NotFound('Not Found'))
    })

    it('should return all keys with false values', async () => {
      const result = await component.multipleObjectsExist(keys)

      expect(result).toEqual({
        'test/file1.txt': false,
        'test/file2.txt': false,
        'test/file3.txt': false
      })
    })

    it('should send HeadObjectCommand for each key with correct bucket and key', async () => {
      await component.multipleObjectsExist(keys)

      expect(sendMock).toHaveBeenCalledTimes(3)
      keys.forEach((key, index) => {
        const command = sendMock.mock.calls[index][0]
        expect(command.input).toEqual({
          Bucket: bucketName,
          Key: key
        })
      })
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
