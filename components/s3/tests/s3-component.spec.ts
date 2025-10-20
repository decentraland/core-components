import { IConfigComponent } from '@well-known-components/interfaces'
import { createConfigMockedComponent } from '@dcl/core-commons'
import { createS3Component } from '../src/component'
import { IS3Component } from '../src/types'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

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
  
  // Reset the command mocks to ensure they return the correct structure
  const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3')
  PutObjectCommand.mockImplementation((params: any) => ({ input: params }))
  GetObjectCommand.mockImplementation((params: any) => ({ input: params }))
  DeleteObjectCommand.mockImplementation((params: any) => ({ input: params }))
  ListObjectsV2Command.mockImplementation((params: any) => ({ input: params }))
  HeadObjectCommand.mockImplementation((params: any) => ({ input: params }))

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
  jest.resetAllMocks()
})

describe('when uploading objects', () => {
  let key: string
  let body: string
  let contentType: string

  beforeEach(() => {
    key = 'test/file.txt'
    body = 'test content'
    contentType = 'text/plain'
  })

  describe('and the upload succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        ETag: '"abc123"'
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return ETag from S3', async () => {
      const result = await component.uploadObject(key, body, contentType)

      expect(result.ETag).toEqual('"abc123"')
    })

    it('should send PutObjectCommand with correct bucket, key, body, and content type', async () => {
      await component.uploadObject(key, body, contentType)

      expect(sendMock).toHaveBeenCalledTimes(1)
      const command = sendMock.mock.calls[0][0]
      expect(command).toHaveProperty('input')
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

    afterEach(() => {
      jest.resetAllMocks()
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

describe('when downloading objects as string', () => {
  let key: string
  let content: string

  beforeEach(() => {
    key = 'test/file.txt'
    content = 'test content'
  })

  describe('and the object exists', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Body: {
          transformToString: jest.fn().mockResolvedValue(content)
        }
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return object content as string', async () => {
      const result = await component.downloadObjectAsString(key)

      expect(result).toEqual(content)
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsString(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const { NoSuchKey } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NoSuchKey('The specified key does not exist'))
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return null', async () => {
      const result = await component.downloadObjectAsString(key)

      expect(result).toBeNull()
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsString(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })

  describe('and the object has no body', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Body: null
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return null', async () => {
      const result = await component.downloadObjectAsString(key)

      expect(result).toBeNull()
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsString(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })

  describe('and there is an S3 error', () => {
    beforeEach(() => {
      sendMock.mockRejectedValueOnce(new Error('S3 connection error'))
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should throw error with failure message', async () => {
      await expect(component.downloadObjectAsString(key)).rejects.toThrow('S3 connection error')
    })

    it('should send GetObjectCommand with correct bucket and key before failing', async () => {
      await expect(component.downloadObjectAsString(key)).rejects.toThrow()

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })
})

describe('when downloading objects as JSON', () => {
  let key: string
  let jsonContent: string
  let parsedJson: any

  beforeEach(() => {
    key = 'test/config.json'
    parsedJson = { name: 'test', value: 42 }
    jsonContent = JSON.stringify(parsedJson)
  })

  describe('and the object exists', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Body: {
          transformToString: jest.fn().mockResolvedValue(jsonContent)
        }
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return parsed JSON object', async () => {
      const result = await component.downloadObjectAsJson(key)

      expect(result).toEqual(parsedJson)
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsJson(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const { NoSuchKey } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NoSuchKey('The specified key does not exist'))
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return null', async () => {
      const result = await component.downloadObjectAsJson(key)

      expect(result).toBeNull()
    })
  })
})

describe('when downloading objects as buffer', () => {
  let key: string
  let bufferContent: Uint8Array

  beforeEach(() => {
    key = 'test/image.png'
    bufferContent = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) // PNG header
  })

  describe('and the object exists', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Body: {
          transformToByteArray: jest.fn().mockResolvedValue(bufferContent)
        }
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return object content as Buffer', async () => {
      const result = await component.downloadObjectAsBuffer(key)

      expect(result).toEqual(Buffer.from(bufferContent))
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsBuffer(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const { NoSuchKey } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NoSuchKey('The specified key does not exist'))
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return null', async () => {
      const result = await component.downloadObjectAsBuffer(key)

      expect(result).toBeNull()
    })
  })
})

describe('when downloading objects as stream', () => {
  let key: string
  let mockStream: AsyncIterable<Uint8Array>

  beforeEach(() => {
    key = 'test/large-file.csv'
    mockStream = {
      async *[Symbol.asyncIterator]() {
        yield new Uint8Array([1, 2, 3])
        yield new Uint8Array([4, 5, 6])
      }
    }
  })

  describe('and the object exists', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Body: mockStream
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return object content as stream', async () => {
      const result = await component.downloadObjectAsStream(key)

      expect(result).toBe(mockStream)
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsStream(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })

  describe('and downloading with range', () => {
    let start: number
    let end: number

    beforeEach(() => {
      start = 0
      end = 1023
      sendMock.mockResolvedValueOnce({
        Body: mockStream
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should send GetObjectCommand with correct range header', async () => {
      await component.downloadObjectAsStream(key, start, end)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
        Range: 'bytes=0-1023'
      }))
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const { NoSuchKey } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NoSuchKey('The specified key does not exist'))
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return null', async () => {
      const result = await component.downloadObjectAsStream(key)

      expect(result).toBeNull()
    })
  })
})

describe('when deleting objects', () => {
  let key: string

  beforeEach(() => {
    key = 'test/file.txt'
  })

  describe('and the delete succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({})
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should complete without throwing', async () => {
      await expect(component.deleteObject(key)).resolves.not.toThrow()
    })

    it('should send DeleteObjectCommand with correct bucket and key', async () => {
      await component.deleteObject(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })

  describe('and the delete fails', () => {
    beforeEach(() => {
      sendMock.mockRejectedValueOnce(new Error('S3 delete failed'))
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should throw error with failure message', async () => {
      await expect(component.deleteObject(key)).rejects.toThrow('S3 delete failed')
    })

    it('should send DeleteObjectCommand with correct bucket and key before failing', async () => {
      await expect(component.deleteObject(key)).rejects.toThrow()

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })
})

describe('when listing objects', () => {
  describe('and objects exist', () => {
    let mockContents: any[]

    beforeEach(() => {
      mockContents = [{ Key: 'test/file1.txt' }, { Key: 'test/file2.txt' }, { Key: 'test/file3.txt' }]
      sendMock.mockResolvedValueOnce({
        Contents: mockContents
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return array of all object keys', async () => {
      const result = await component.listObjects()

      expect(result).toEqual(['test/file1.txt', 'test/file2.txt', 'test/file3.txt'])
    })

    it('should send ListObjectsV2Command with correct bucket and default parameters', async () => {
      await component.listObjects()

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: undefined,
        MaxKeys: 1000
      }))
    })
  })

  describe('and listing with prefix', () => {
    let prefix: string
    let mockContents: any[]

    beforeEach(() => {
      prefix = 'test/'
      mockContents = [{ Key: 'test/file1.txt' }, { Key: 'test/file2.txt' }]
      sendMock.mockResolvedValueOnce({
        Contents: mockContents
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return array of keys matching prefix', async () => {
      const result = await component.listObjects(prefix)

      expect(result).toEqual(['test/file1.txt', 'test/file2.txt'])
    })

    it('should send ListObjectsV2Command with correct bucket and prefix', async () => {
      await component.listObjects(prefix)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: 1000
      }))
    })
  })

  describe('and listing with max keys', () => {
    let prefix: string
    let maxKeys: number
    let mockContents: any[]

    beforeEach(() => {
      prefix = 'test/'
      maxKeys = 10
      mockContents = [{ Key: 'test/file1.txt' }]
      sendMock.mockResolvedValueOnce({
        Contents: mockContents
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return array limited by max keys parameter', async () => {
      const result = await component.listObjects(prefix, maxKeys)

      expect(result).toEqual(['test/file1.txt'])
    })

    it('should send ListObjectsV2Command with correct bucket, prefix, and maxKeys', async () => {
      await component.listObjects(prefix, maxKeys)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: maxKeys
      }))
    })
  })

  describe('and no objects exist', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Contents: []
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return empty array', async () => {
      const result = await component.listObjects()

      expect(result).toEqual([])
    })

    it('should send ListObjectsV2Command with correct bucket and default parameters', async () => {
      await component.listObjects()

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: undefined,
        MaxKeys: 1000
      }))
    })
  })

  describe('and Contents is undefined', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({})
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return empty array', async () => {
      const result = await component.listObjects()

      expect(result).toEqual([])
    })

    it('should send ListObjectsV2Command with correct bucket and default parameters', async () => {
      await component.listObjects()

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: undefined,
        MaxKeys: 1000
      }))
    })
  })
})

describe('when getting object metadata', () => {
  let key: string
  let s3Metadata: any
  let expectedMetadata: any

  beforeEach(() => {
    key = 'test/file.txt'
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

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return metadata with content length, type, date, and ETag', async () => {
      const result = await component.getObjectMetadata(key)

      expect(result).toEqual(expectedMetadata)
    })

    it('should send HeadObjectCommand with correct bucket and key', async () => {
      await component.getObjectMetadata(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new HeadObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const { NotFound } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValueOnce(new NotFound('Not Found'))
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return null', async () => {
      const result = await component.getObjectMetadata(key)

      expect(result).toBeNull()
    })

    it('should send HeadObjectCommand with correct bucket and key', async () => {
      await component.getObjectMetadata(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new HeadObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })

  describe('and there is an S3 error', () => {
    beforeEach(() => {
      sendMock.mockRejectedValueOnce(new Error('S3 connection error'))
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should throw error with failure message', async () => {
      await expect(component.getObjectMetadata(key)).rejects.toThrow('S3 connection error')
    })

    it('should send HeadObjectCommand with correct bucket and key before failing', async () => {
      await expect(component.getObjectMetadata(key)).rejects.toThrow()

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new HeadObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
    })
  })
})

describe('when checking if object exists', () => {
  let key: string

  beforeEach(() => {
    key = 'test/file.txt'
  })

  describe('and the object exists', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        ContentLength: 1024,
        ContentType: 'text/plain'
      })
    })

    afterEach(() => {
      jest.resetAllMocks()
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

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return false', async () => {
      const result = await component.objectExists(key)

      expect(result).toBe(false)
    })

    it('should send HeadObjectCommand with correct bucket and key', async () => {
      await component.objectExists(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(new HeadObjectCommand({
        Bucket: bucketName,
        Key: key
      }))
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

    afterEach(() => {
      jest.resetAllMocks()
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

    afterEach(() => {
      jest.resetAllMocks()
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
        expect(sendMock).toHaveBeenCalledWith(new HeadObjectCommand({
          Bucket: bucketName,
          Key: key
        }))
      })
    })
  })

  describe('and no objects exist', () => {
    beforeEach(() => {
      const { NotFound } = require('@aws-sdk/client-s3')
      sendMock.mockRejectedValue(new NotFound('Not Found'))
    })

    afterEach(() => {
      jest.resetAllMocks()
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
        expect(sendMock).toHaveBeenCalledWith(new HeadObjectCommand({
          Bucket: bucketName,
          Key: key
        }))
      })
    })
  })

  describe('and empty array is provided', () => {
    beforeEach(() => {
      keys = []
    })

    afterEach(() => {
      jest.resetAllMocks()
    })

    it('should return empty object', async () => {
      const result = await component.multipleObjectsExist(keys)

      expect(result).toEqual({})
      expect(sendMock).not.toHaveBeenCalled()
    })
  })
})