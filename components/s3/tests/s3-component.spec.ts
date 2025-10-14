import { IConfigComponent } from '@well-known-components/interfaces'
import { createConfigMockedComponent } from '@dcl/core-commons'
import { createS3Component } from '../src/component'
import { IS3Component } from '../src/types'

// Mock the AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  GetObjectCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  DeleteObjectCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  ListObjectsV2Command: jest.fn().mockImplementation((params) => ({ input: params })),
  HeadObjectCommand: jest.fn().mockImplementation((params) => ({ input: params }))
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

describe('when uploading objects', () => {
  const key = 'test/file.txt'
  const body = 'test content'
  const contentType = 'text/plain'

  describe('and the upload succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        ETag: '"abc123"'
      })
    })

    it('should return ETag from S3', async () => {
      const result = await component.uploadObject(key, body, contentType)

      expect(result.ETag).toEqual('"abc123"')
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and uploading without content type', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        ETag: '"abc123"'
      })
    })

    it('should return ETag without content type header', async () => {
      const result = await component.uploadObject(key, body)

      expect(result.ETag).toEqual('"abc123"')
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and uploading Buffer content', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        ETag: '"abc123"'
      })
    })

    it('should return ETag when uploading Buffer', async () => {
      const buffer = Buffer.from(body)
      const result = await component.uploadObject(key, buffer, contentType)

      expect(result.ETag).toEqual('"abc123"')
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the upload fails', () => {
    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('S3 upload failed'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.uploadObject(key, body, contentType)).rejects.toThrow('S3 upload failed')
    })
  })
})

describe('when downloading objects', () => {
  const key = 'test/file.txt'
  const content = 'test content'

  describe('and the object exists', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        Body: {
          transformToString: jest.fn().mockResolvedValue(content)
        }
      })
    })

    it('should return object content as string', async () => {
      const result = await component.downloadObject(key)

      expect(result).toEqual(content)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const error: any = new Error('NoSuchKey')
      error.name = 'NoSuchKey'
      sendMock.mockRejectedValue(error)
    })

    it('should return null', async () => {
      const result = await component.downloadObject(key)

      expect(result).toBeNull()
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the object has no body', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        Body: null
      })
    })

    it('should return null', async () => {
      const result = await component.downloadObject(key)

      expect(result).toBeNull()
    })
  })

  describe('and there is an S3 error', () => {
    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('S3 connection error'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.downloadObject(key)).rejects.toThrow('S3 connection error')
    })
  })
})

describe('when deleting objects', () => {
  const key = 'test/file.txt'

  describe('and the delete succeeds', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({})
    })

    it('should complete without throwing', async () => {
      await expect(component.deleteObject(key)).resolves.not.toThrow()
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the delete fails', () => {
    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('S3 delete failed'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.deleteObject(key)).rejects.toThrow('S3 delete failed')
    })
  })
})

describe('when listing objects', () => {
  describe('and objects exist', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        Contents: [{ Key: 'test/file1.txt' }, { Key: 'test/file2.txt' }, { Key: 'test/file3.txt' }]
      })
    })

    it('should return array of all object keys', async () => {
      const result = await component.listObjects()

      expect(result).toEqual(['test/file1.txt', 'test/file2.txt', 'test/file3.txt'])
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and listing with prefix', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        Contents: [{ Key: 'test/file1.txt' }, { Key: 'test/file2.txt' }]
      })
    })

    it('should return array of keys matching prefix', async () => {
      const result = await component.listObjects('test/')

      expect(result).toEqual(['test/file1.txt', 'test/file2.txt'])
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and listing with max keys', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        Contents: [{ Key: 'test/file1.txt' }]
      })
    })

    it('should return array limited by max keys parameter', async () => {
      const result = await component.listObjects('test/', 10)

      expect(result).toEqual(['test/file1.txt'])
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and no objects exist', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        Contents: []
      })
    })

    it('should return empty array', async () => {
      const result = await component.listObjects()

      expect(result).toEqual([])
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and Contents is undefined', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({})
    })

    it('should return empty array', async () => {
      const result = await component.listObjects()

      expect(result).toEqual([])
    })
  })
})

describe('when getting object metadata', () => {
  const key = 'test/file.txt'
  const metadata = {
    ContentLength: 1024,
    ContentType: 'text/plain',
    LastModified: new Date('2024-01-01'),
    ETag: '"abc123"'
  }

  describe('and the object exists', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue(metadata)
    })

    it('should return metadata with content length, type, date, and ETag', async () => {
      const result = await component.getObjectMetadata(key)

      expect(result).toEqual(metadata)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const error: any = new Error('NotFound')
      error.name = 'NotFound'
      sendMock.mockRejectedValue(error)
    })

    it('should return null', async () => {
      const result = await component.getObjectMetadata(key)

      expect(result).toBeNull()
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and there is an S3 error', () => {
    beforeEach(() => {
      sendMock.mockRejectedValue(new Error('S3 connection error'))
    })

    it('should throw error with failure message', async () => {
      await expect(component.getObjectMetadata(key)).rejects.toThrow('S3 connection error')
    })
  })
})

describe('when checking if object exists', () => {
  const key = 'test/file.txt'

  describe('and the object exists', () => {
    beforeEach(() => {
      sendMock.mockResolvedValue({
        ContentLength: 1024,
        ContentType: 'text/plain'
      })
    })

    it('should return true', async () => {
      const result = await component.objectExists(key)

      expect(result).toBe(true)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the object does not exist', () => {
    beforeEach(() => {
      const error: any = new Error('NotFound')
      error.name = 'NotFound'
      sendMock.mockRejectedValue(error)
    })

    it('should return false', async () => {
      const result = await component.objectExists(key)

      expect(result).toBe(false)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })
})

describe('when checking if multiple objects exist', () => {
  const keys = ['test/file1.txt', 'test/file2.txt', 'test/file3.txt']

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
      expect(sendMock).toHaveBeenCalledTimes(3)
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
        const error: any = new Error('NotFound')
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
      expect(sendMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('and no objects exist', () => {
    beforeEach(() => {
      const error: any = new Error('NotFound')
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
