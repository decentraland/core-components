import { IConfigComponent } from '@well-known-components/interfaces'
import { createConfigMockedComponent } from '@dcl/core-commons'
import { createS3Component } from '../src/component'
import { IS3Component } from '../src/types'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import { setupS3Mocks, setMockS3Client } from './mocks'

// Mock the AWS SDK
jest.mock('@aws-sdk/client-s3')

let config: IConfigComponent
let component: IS3Component
let mockS3Client: any
let sendMock: jest.Mock
let bucketName: string
let s3Endpoint: string

beforeAll(() => {
  // Setup S3 mocks once for all tests
  setupS3Mocks()
})

beforeEach(async () => {
  bucketName = 'test-bucket'
  s3Endpoint = 'http://localhost:4566'
  sendMock = jest.fn()

  mockS3Client = {
    send: sendMock
  }

  // Update S3Client mock to use our new mock client
  setMockS3Client(mockS3Client)

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

  describe('and server-side encryption is requested via options', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({ ETag: '"abc123"' })
    })

    it('should include the ServerSideEncryption parameter in the PutObjectCommand', async () => {
      await component.uploadObject(key, body, contentType, { serverSideEncryption: 'AES256' })

      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual(
        expect.objectContaining({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: 'AES256'
        })
      )
    })
  })

  describe('and cacheControl is provided via options', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({ ETag: '"abc123"' })
    })

    it('should forward the value as the CacheControl field on the PutObjectCommand', async () => {
      await component.uploadObject(key, body, contentType, { cacheControl: 'private, max-age=0, no-cache' })

      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual(
        expect.objectContaining({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'private, max-age=0, no-cache'
        })
      )
    })
  })

  describe('and acl is provided via options', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({ ETag: '"abc123"' })
    })

    it('should forward the value as the ACL field on the PutObjectCommand', async () => {
      await component.uploadObject(key, body, contentType, { acl: 'public-read' })

      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual(
        expect.objectContaining({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
          ACL: 'public-read'
        })
      )
    })
  })

  describe('and cacheControl, acl, and serverSideEncryption are all provided together', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({ ETag: '"abc123"' })
    })

    it('should forward every option on the same PutObjectCommand', async () => {
      await component.uploadObject(key, body, contentType, {
        cacheControl: 'public, max-age=31536000, immutable',
        acl: 'public-read',
        serverSideEncryption: 'AES256'
      })

      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual(
        expect.objectContaining({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
          ACL: 'public-read',
          ServerSideEncryption: 'AES256'
        })
      )
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

describe('when copying objects', () => {
  let sourceKey: string
  let destKey: string

  beforeEach(() => {
    sourceKey = 'source/file.txt'
    destKey = 'dest/file.txt'
  })

  describe('and the copy succeeds with default options', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({ CopyObjectResult: { ETag: '"copy-etag"' } })
    })

    it('should return the destination ETag from the CopyObjectResult', async () => {
      const result = await component.copyObject(sourceKey, destKey)

      expect(result.ETag).toEqual('"copy-etag"')
    })

    it('should send CopyObjectCommand with same-bucket CopySource defaulting to the component bucket', async () => {
      await component.copyObject(sourceKey, destKey)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new CopyObjectCommand({
          Bucket: bucketName,
          Key: destKey,
          CopySource: `/${bucketName}/source/file.txt`,
          MetadataDirective: undefined,
          ACL: undefined,
          CacheControl: undefined,
          ContentType: undefined,
          ServerSideEncryption: undefined
        })
      )
    })
  })

  describe('and the source key contains reserved characters', () => {
    beforeEach(() => {
      sourceKey = 'a b+c/special?key.txt'
      sendMock.mockResolvedValueOnce({ CopyObjectResult: { ETag: '"copy-etag"' } })
    })

    it('should URL-encode the source key while preserving its path separators', async () => {
      await component.copyObject(sourceKey, destKey)

      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual(
        expect.objectContaining({
          CopySource: `/${bucketName}/a%20b%2Bc/special%3Fkey.txt`
        })
      )
    })
  })

  describe('and sourceBucket is provided via options', () => {
    let sourceBucket: string

    beforeEach(() => {
      sourceBucket = 'other-bucket'
      sendMock.mockResolvedValueOnce({ CopyObjectResult: { ETag: '"copy-etag"' } })
    })

    it('should use the provided bucket in the CopySource', async () => {
      await component.copyObject(sourceKey, destKey, { sourceBucket })

      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual(
        expect.objectContaining({
          Bucket: bucketName,
          CopySource: `/${sourceBucket}/source/file.txt`
        })
      )
    })
  })

  describe('and metadataDirective is REPLACE with contentType and cacheControl', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({ CopyObjectResult: { ETag: '"copy-etag"' } })
    })

    it('should forward every override on the CopyObjectCommand', async () => {
      await component.copyObject(sourceKey, destKey, {
        metadataDirective: 'REPLACE',
        contentType: 'application/json',
        cacheControl: 'max-age=3600',
        acl: 'public-read'
      })

      expect(sendMock).toHaveBeenCalledWith(
        new CopyObjectCommand({
          Bucket: bucketName,
          Key: destKey,
          CopySource: `/${bucketName}/source/file.txt`,
          MetadataDirective: 'REPLACE',
          ACL: 'public-read',
          CacheControl: 'max-age=3600',
          ContentType: 'application/json',
          ServerSideEncryption: undefined
        })
      )
    })
  })

  describe('and an explicit serverSideEncryption is provided via options', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({ CopyObjectResult: { ETag: '"copy-etag"' } })
    })

    it('should forward the encryption value on the CopyObjectCommand', async () => {
      await component.copyObject(sourceKey, destKey, { serverSideEncryption: 'AES256' })

      expect(sendMock.mock.calls[0][0].input).toEqual(
        expect.objectContaining({ ServerSideEncryption: 'AES256' })
      )
    })
  })

  describe('and the copy fails', () => {
    beforeEach(() => {
      sendMock.mockRejectedValueOnce(new Error('S3 copy failed'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.copyObject(sourceKey, destKey)).rejects.toThrow('S3 copy failed')
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

    it('should return object content as string', async () => {
      const result = await component.downloadObjectAsString(key)

      expect(result).toEqual(content)
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsString(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const error = new Error('The specified key does not exist')
      error.name = 'NoSuchKey'
      sendMock.mockRejectedValueOnce(error)
    })

    it('should return null', async () => {
      const result = await component.downloadObjectAsString(key)

      expect(result).toBeNull()
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsString(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
    })
  })

  describe('and the object has no body', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Body: null
      })
    })

    it('should return null', async () => {
      const result = await component.downloadObjectAsString(key)

      expect(result).toBeNull()
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsString(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
    })
  })

  describe('and there is an S3 error', () => {
    beforeEach(() => {
      sendMock.mockRejectedValueOnce(new Error('S3 connection error'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.downloadObjectAsString(key)).rejects.toThrow('S3 connection error')
    })

    it('should send GetObjectCommand with correct bucket and key before failing', async () => {
      await expect(component.downloadObjectAsString(key)).rejects.toThrow()

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
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
    describe('and the object is valid JSON', () => {
      beforeEach(() => {
        sendMock.mockResolvedValueOnce({
          Body: {
            transformToString: jest.fn().mockResolvedValue(jsonContent)
          }
        })
      })

      it('should return parsed JSON object', async () => {
        const result = await component.downloadObjectAsJson(key)

        expect(result).toEqual(parsedJson)
      })

      it('should send GetObjectCommand with correct bucket and key', async () => {
        await component.downloadObjectAsJson(key)

        expect(sendMock).toHaveBeenCalledTimes(1)
        expect(sendMock).toHaveBeenCalledWith(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: key
          })
        )
      })
    })

    describe('and the object is not valid JSON', () => {
      let invalidJsonContent: string

      beforeEach(() => {
        invalidJsonContent = '{"name": "test", "value": 42, "incomplete": }' // Invalid JSON - incomplete value
        sendMock.mockResolvedValueOnce({
          Body: {
            transformToString: jest.fn().mockResolvedValue(invalidJsonContent)
          }
        })
      })

      it('should throw error with JSON parsing failure message', async () => {
        await expect(component.downloadObjectAsJson(key)).rejects.toThrow()
      })

      it('should send GetObjectCommand with correct bucket and key before failing', async () => {
        await expect(component.downloadObjectAsJson(key)).rejects.toThrow()

        expect(sendMock).toHaveBeenCalledTimes(1)
        expect(sendMock).toHaveBeenCalledWith(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: key
          })
        )
      })
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const error = new Error('The specified key does not exist')
      error.name = 'NoSuchKey'
      sendMock.mockRejectedValueOnce(error)
    })

    it('should return null', async () => {
      const result = await component.downloadObjectAsJson(key)

      expect(result).toBeNull()
    })
  })

  describe('and the object body is an empty string', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Body: {
          transformToString: jest.fn().mockResolvedValue('')
        }
      })
    })

    it('should return null instead of throwing a JSON.parse error', async () => {
      const result = await component.downloadObjectAsJson(key)

      expect(result).toBeNull()
    })
  })

  describe('and the object body is a whitespace-only string', () => {
    describe.each(['   ', '\n', '\t\n '])('and the body is %p', (whitespace) => {
      beforeEach(() => {
        sendMock.mockResolvedValueOnce({
          Body: {
            transformToString: jest.fn().mockResolvedValue(whitespace)
          }
        })
      })

      it('should return null instead of throwing a JSON.parse error', async () => {
        const result = await component.downloadObjectAsJson(key)

        expect(result).toBeNull()
      })
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

    it('should return object content as Buffer', async () => {
      const result = await component.downloadObjectAsBuffer(key)

      expect(result).toEqual(Buffer.from(bufferContent))
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsBuffer(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const error = new Error('The specified key does not exist')
      error.name = 'NoSuchKey'
      sendMock.mockRejectedValueOnce(error)
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

    it('should return object content as stream', async () => {
      const result = await component.downloadObjectAsStream(key)

      expect(result).toBe(mockStream)
    })

    it('should send GetObjectCommand with correct bucket and key', async () => {
      await component.downloadObjectAsStream(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
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

    it('should send GetObjectCommand with correct range header', async () => {
      await component.downloadObjectAsStream(key, start, end)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
          Range: 'bytes=0-1023'
        })
      )
    })
  })

  describe('and downloading with only a start byte (open-ended range)', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({ Body: mockStream })
    })

    it('should send GetObjectCommand with an open-ended range header', async () => {
      await component.downloadObjectAsStream(key, 500)

      expect(sendMock).toHaveBeenCalledWith(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
          Range: 'bytes=500-'
        })
      )
    })
  })

  describe('and downloading with only an end byte (suffix range)', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({ Body: mockStream })
    })

    it('should send GetObjectCommand with a suffix range header', async () => {
      await component.downloadObjectAsStream(key, undefined, 500)

      expect(sendMock).toHaveBeenCalledWith(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
          Range: 'bytes=-500'
        })
      )
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const error = new Error('The specified key does not exist')
      error.name = 'NoSuchKey'
      sendMock.mockRejectedValueOnce(error)
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

    it('should complete without throwing', async () => {
      await expect(component.deleteObject(key)).resolves.not.toThrow()
    })

    it('should send DeleteObjectCommand with correct bucket and key', async () => {
      await component.deleteObject(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
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
      expect(sendMock).toHaveBeenCalledWith(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
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

    it('should return array of all object keys', async () => {
      const result = await component.listObjects()

      expect(result).toEqual(['test/file1.txt', 'test/file2.txt', 'test/file3.txt'])
    })

    it('should send ListObjectsV2Command with correct bucket and default parameters', async () => {
      await component.listObjects()

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: undefined,
          MaxKeys: 1000
        })
      )
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

    it('should return array of keys matching prefix', async () => {
      const result = await component.listObjects(prefix)

      expect(result).toEqual(['test/file1.txt', 'test/file2.txt'])
    })

    it('should send ListObjectsV2Command with correct bucket and prefix', async () => {
      await component.listObjects(prefix)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: 1000
        })
      )
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

    it('should return array limited by max keys parameter', async () => {
      const result = await component.listObjects(prefix, maxKeys)

      expect(result).toEqual(['test/file1.txt'])
    })

    it('should send ListObjectsV2Command with correct bucket, prefix, and maxKeys', async () => {
      await component.listObjects(prefix, maxKeys)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: maxKeys
        })
      )
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
      expect(sendMock).toHaveBeenCalledWith(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: undefined,
          MaxKeys: 1000
        })
      )
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
      expect(sendMock).toHaveBeenCalledWith(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: undefined,
          MaxKeys: 1000,
          ContinuationToken: undefined
        })
      )
    })
  })

  describe('and the total number of objects exceeds a single S3 page', () => {
    let firstPageKeys: string[]
    let secondPageKeys: string[]

    beforeEach(() => {
      firstPageKeys = Array.from({ length: 1000 }, (_, i) => `file-${i}.txt`)
      secondPageKeys = Array.from({ length: 500 }, (_, i) => `file-${1000 + i}.txt`)
      sendMock
        .mockResolvedValueOnce({
          Contents: firstPageKeys.map((Key) => ({ Key })),
          IsTruncated: true,
          NextContinuationToken: 'token-1'
        })
        .mockResolvedValueOnce({
          Contents: secondPageKeys.map((Key) => ({ Key })),
          IsTruncated: false
        })
    })

    it('should paginate using the continuation token and return all keys up to maxKeys', async () => {
      const result = await component.listObjects(undefined, 2000)

      expect(result).toHaveLength(1500)
      expect(result[0]).toBe('file-0.txt')
      expect(result[1499]).toBe('file-1499.txt')
      expect(sendMock).toHaveBeenCalledTimes(2)
      expect(sendMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          input: expect.objectContaining({ ContinuationToken: 'token-1' })
        })
      )
    })
  })
})

describe('when iterating objects as a stream', () => {
  describe('and the results fit in a single page', () => {
    let pageKeys: string[]

    beforeEach(() => {
      pageKeys = ['a/file1.txt', 'a/file2.txt', 'a/file3.txt']
      sendMock.mockResolvedValueOnce({
        Contents: pageKeys.map((Key) => ({ Key })),
        IsTruncated: false
      })
    })

    it('should yield every returned key in order', async () => {
      const yielded: string[] = []
      for await (const key of component.listObjectsIterable()) {
        yielded.push(key)
      }

      expect(yielded).toEqual(pageKeys)
    })
  })

  describe('and the total number of objects exceeds a single S3 page', () => {
    let firstPageKeys: string[]
    let secondPageKeys: string[]

    beforeEach(() => {
      firstPageKeys = Array.from({ length: 1000 }, (_, i) => `file-${i}.txt`)
      secondPageKeys = Array.from({ length: 500 }, (_, i) => `file-${1000 + i}.txt`)
      sendMock
        .mockResolvedValueOnce({
          Contents: firstPageKeys.map((Key) => ({ Key })),
          IsTruncated: true,
          NextContinuationToken: 'token-1'
        })
        .mockResolvedValueOnce({
          Contents: secondPageKeys.map((Key) => ({ Key })),
          IsTruncated: false
        })
    })

    it('should paginate lazily, yielding keys across both pages', async () => {
      const yielded: string[] = []
      for await (const key of component.listObjectsIterable()) {
        yielded.push(key)
      }

      expect(yielded).toHaveLength(1500)
      expect(yielded[0]).toBe('file-0.txt')
      expect(yielded[1499]).toBe('file-1499.txt')
      expect(sendMock).toHaveBeenCalledTimes(2)
      expect(sendMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          input: expect.objectContaining({ ContinuationToken: 'token-1' })
        })
      )
    })
  })

  describe('and the consumer stops iterating early', () => {
    let firstPageKeys: string[]

    beforeEach(() => {
      firstPageKeys = Array.from({ length: 1000 }, (_, i) => `file-${i}.txt`)
      sendMock.mockResolvedValueOnce({
        Contents: firstPageKeys.map((Key) => ({ Key })),
        IsTruncated: true,
        NextContinuationToken: 'token-1'
      })
    })

    it('should not fetch the next page after the consumer breaks out of the loop', async () => {
      const yielded: string[] = []
      for await (const key of component.listObjectsIterable()) {
        yielded.push(key)
        if (yielded.length === 5) break
      }

      expect(yielded).toHaveLength(5)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and a prefix is supplied', () => {
    let prefix: string

    beforeEach(() => {
      prefix = 'manifest/'
      sendMock.mockResolvedValueOnce({
        Contents: [{ Key: 'manifest/a.json' }],
        IsTruncated: false
      })
    })

    it('should forward the prefix on the ListObjectsV2Command', async () => {
      const yielded: string[] = []
      for await (const key of component.listObjectsIterable(prefix)) {
        yielded.push(key)
      }

      const command = sendMock.mock.calls[0][0]
      expect(command.input).toEqual(
        expect.objectContaining({
          Bucket: bucketName,
          Prefix: prefix
        })
      )
    })
  })

  describe('and an object in the response has no Key', () => {
    beforeEach(() => {
      sendMock.mockResolvedValueOnce({
        Contents: [{ Key: 'a.txt' }, { Key: undefined }, { Key: '' }, { Key: 'b.txt' }],
        IsTruncated: false
      })
    })

    it('should skip the entries without a key and yield only the real ones', async () => {
      const yielded: string[] = []
      for await (const key of component.listObjectsIterable()) {
        yielded.push(key)
      }

      expect(yielded).toEqual(['a.txt', 'b.txt'])
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

    it('should return metadata with content length, type, date, and ETag', async () => {
      const result = await component.getObjectMetadata(key)

      expect(result).toEqual(expectedMetadata)
    })

    it('should send HeadObjectCommand with correct bucket and key', async () => {
      await component.getObjectMetadata(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const error = new Error('Not Found')
      error.name = 'NotFound'
      sendMock.mockRejectedValueOnce(error)
    })

    it('should return null', async () => {
      const result = await component.getObjectMetadata(key)

      expect(result).toBeNull()
    })

    it('should send HeadObjectCommand with correct bucket and key', async () => {
      await component.getObjectMetadata(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
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
      expect(sendMock).toHaveBeenCalledWith(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
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
      const error = new Error('Not Found')
      error.name = 'NotFound'
      sendMock.mockRejectedValueOnce(error)
    })

    it('should return false', async () => {
      const result = await component.objectExists(key)

      expect(result).toBe(false)
    })

    it('should send HeadObjectCommand with correct bucket and key', async () => {
      await component.objectExists(key)

      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: key
        })
      )
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
      sendMock.mockImplementation((command: any) => {
        const key = command.input.Key
        if (key === 'test/file1.txt' || key === 'test/file3.txt') {
          return Promise.resolve({
            ContentLength: 1024,
            ContentType: 'text/plain'
          })
        }
        const error = new Error('Not Found')
        error.name = 'NotFound'
        return Promise.reject(error)
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
        expect(sendMock).toHaveBeenCalledWith(
          new HeadObjectCommand({
            Bucket: bucketName,
            Key: key
          })
        )
      })
    })
  })

  describe('and no objects exist', () => {
    beforeEach(() => {
      const error = new Error('Not Found')
      error.name = 'NotFound'
      sendMock.mockRejectedValue(error)
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
        expect(sendMock).toHaveBeenCalledWith(
          new HeadObjectCommand({
            Bucket: bucketName,
            Key: key
          })
        )
      })
    })
  })

  describe('and empty array is provided', () => {
    beforeEach(() => {
      keys = []
    })

    it('should return empty object', async () => {
      const result = await component.multipleObjectsExist(keys)

      expect(result).toEqual({})
      expect(sendMock).not.toHaveBeenCalled()
    })
  })

  describe('and the key count exceeds a single batch', () => {
    // 51 keys forces two slices: 0..49 then 50. Locks in the batch-boundary
    // behavior against accidental off-by-one regressions in the slice loop.
    const largeKeys = Array.from({ length: 51 }, (_, i) => `bulk/file-${i}.txt`)

    beforeEach(() => {
      sendMock.mockResolvedValue({ ContentLength: 1, ContentType: 'text/plain' })
    })

    it('should issue one HeadObject per key across batches', async () => {
      const result = await component.multipleObjectsExist(largeKeys)

      expect(sendMock).toHaveBeenCalledTimes(largeKeys.length)
      expect(Object.keys(result)).toHaveLength(largeKeys.length)
      largeKeys.forEach((key) => {
        expect(result[key]).toBe(true)
      })
    })
  })
})

describe('when creating the component with AWS_S3_SERVER_SIDE_ENCRYPTION configured', () => {
  let sseConfig: IConfigComponent

  describe('and the value matches a known AWS SDK enum value', () => {
    describe.each(['AES256', 'aws:kms', 'aws:kms:dsse'])('and the value is %p', (validValue) => {
      beforeEach(() => {
        sseConfig = createConfigMockedComponent({
          requireString: jest.fn().mockImplementation((key: string) => {
            if (key === 'AWS_S3_BUCKET_NAME') return bucketName
            throw new Error(`Unknown key: ${key}`)
          }),
          getString: jest.fn().mockImplementation((key: string) => {
            if (key === 'AWS_S3_SERVER_SIDE_ENCRYPTION') return validValue
            if (key === 'AWS_REGION') return 'us-east-1'
            return undefined
          })
        })
      })

      it('should create the component and apply the encryption to uploads without an explicit option', async () => {
        const sseComponent = await createS3Component({ config: sseConfig })
        sendMock.mockResolvedValueOnce({ ETag: '"abc123"' })

        await sseComponent.uploadObject('k', 'body')

        expect(sendMock.mock.calls[0][0].input).toEqual(
          expect.objectContaining({ ServerSideEncryption: validValue })
        )
      })

      it('should apply the encryption to copies without an explicit option', async () => {
        const sseComponent = await createS3Component({ config: sseConfig })
        sendMock.mockResolvedValueOnce({ CopyObjectResult: { ETag: '"copy-etag"' } })

        await sseComponent.copyObject('source.txt', 'dest.txt')

        expect(sendMock.mock.calls[0][0].input).toEqual(
          expect.objectContaining({ ServerSideEncryption: validValue })
        )
      })
    })
  })

  describe('and the value does not match any known AWS SDK enum value', () => {
    beforeEach(() => {
      sseConfig = createConfigMockedComponent({
        requireString: jest.fn().mockImplementation((key: string) => {
          if (key === 'AWS_S3_BUCKET_NAME') return bucketName
          throw new Error(`Unknown key: ${key}`)
        }),
        getString: jest.fn().mockImplementation((key: string) => {
          if (key === 'AWS_S3_SERVER_SIDE_ENCRYPTION') return 'aes256'
          if (key === 'AWS_REGION') return 'us-east-1'
          return undefined
        })
      })
    })

    it('should reject at startup with a message listing the accepted values', async () => {
      await expect(createS3Component({ config: sseConfig })).rejects.toThrow(
        /Invalid AWS_S3_SERVER_SIDE_ENCRYPTION: "aes256"\. Expected one of: .*AES256/
      )
    })
  })
})
