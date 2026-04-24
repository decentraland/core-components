import { Readable } from 'stream'
import { IConfigComponent } from '@well-known-components/interfaces'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  ServerSideEncryption,
  NoSuchKey,
  NotFound
} from '@aws-sdk/client-s3'

import { CopyObjectOptions, IS3Component, UploadObjectOptions } from './types'

const S3_LIST_PAGE_SIZE = 1000
// Upper bound on keys processed per `Promise.all` group in `multipleObjectsExist`.
// Matches AWS SDK v3's default `maxSockets` per host, so the in-flight HeadObject
// requests from one batch can use the full pool without queuing.
const MULTIPLE_EXISTS_BATCH_SIZE = 50

/**
 * Checks whether an error from the S3 SDK represents a missing object.
 * Does NOT handle AccessDenied (403) — S3 returns 403 even when the object
 * does not exist if the caller lacks permissions (anti-enumeration behavior).
 */
function isNotFoundError(error: unknown): boolean {
  if (error instanceof NoSuchKey || error instanceof NotFound) {
    return true
  }
  if (error && typeof error === 'object') {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } }
    return err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404
  }
  return false
}

function buildRangeHeader(start?: number, end?: number): string | undefined {
  if (start === undefined && end === undefined) {
    return undefined
  }
  return `bytes=${start ?? ''}-${end ?? ''}`
}

const VALID_SERVER_SIDE_ENCRYPTION = new Set<string>(Object.values(ServerSideEncryption))

function parseServerSideEncryption(raw: string | undefined): ServerSideEncryption | undefined {
  if (!raw) {
    return undefined
  }
  if (!VALID_SERVER_SIDE_ENCRYPTION.has(raw)) {
    throw new Error(
      `Invalid AWS_S3_SERVER_SIDE_ENCRYPTION: "${raw}". Expected one of: ${Array.from(VALID_SERVER_SIDE_ENCRYPTION).join(', ')}.`
    )
  }
  return raw as ServerSideEncryption
}

export async function createS3Component({ config }: { config: IConfigComponent }): Promise<IS3Component> {
  const bucketName = await config.requireString('AWS_S3_BUCKET_NAME')
  const optionalEndpoint = await config.getString('AWS_S3_ENDPOINT')
  const region = await config.getString('AWS_REGION')
  const defaultServerSideEncryption = parseServerSideEncryption(
    await config.getString('AWS_S3_SERVER_SIDE_ENCRYPTION')
  )

  const client = new S3Client({
    endpoint: optionalEndpoint || undefined,
    region: region || undefined,
    forcePathStyle: !!optionalEndpoint // Required for LocalStack/MinIO
  })

  async function uploadObject(
    key: string,
    body: string | Buffer | Readable,
    contentType?: string,
    options?: UploadObjectOptions
  ): Promise<{ ETag?: string }> {
    const sse = options?.serverSideEncryption ?? defaultServerSideEncryption

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: options?.cacheControl,
      ACL: options?.acl,
      ServerSideEncryption: sse
    })

    const response = await client.send(command)
    return { ETag: response.ETag }
  }

  async function copyObject(
    sourceKey: string,
    destKey: string,
    options?: CopyObjectOptions
  ): Promise<{ ETag?: string }> {
    const srcBucket = options?.sourceBucket ?? bucketName
    // S3's CopySource wants `/<bucket>/<url-encoded-key>`. encodeURIComponent
    // escapes `/` too, but object keys use `/` as a path separator inside the
    // key itself, so we restore them after encoding. All other reserved
    // characters (spaces, `+`, `?`, etc.) stay encoded as AWS requires.
    const copySource = `/${srcBucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}`
    const sse = options?.serverSideEncryption ?? defaultServerSideEncryption

    const command = new CopyObjectCommand({
      Bucket: bucketName,
      Key: destKey,
      CopySource: copySource,
      MetadataDirective: options?.metadataDirective,
      ACL: options?.acl,
      CacheControl: options?.cacheControl,
      ContentType: options?.contentType,
      ServerSideEncryption: sse
    })

    const response = await client.send(command)
    return { ETag: response.CopyObjectResult?.ETag }
  }

  async function downloadObjectAsString(key: string): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      })

      const response = await client.send(command)

      if (!response.Body) {
        return null
      }

      return await response.Body.transformToString()
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return null
      }
      throw error
    }
  }

  async function downloadObjectAsJson<T = any>(key: string): Promise<T | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      })

      const response = await client.send(command)

      if (!response.Body) {
        return null
      }

      const bodyContents = await response.Body.transformToString()
      // Treat whitespace-only bodies the same as empty: JSON.parse of `'  '`
      // or `'\n'` throws SyntaxError, which would escape the try/catch and
      // surface as an error instead of a null — inconsistent with the empty
      // string path.
      if (!bodyContents || !bodyContents.trim()) {
        return null
      }
      return JSON.parse(bodyContents) as T
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return null
      }
      throw error
    }
  }

  async function downloadObjectAsBuffer(key: string): Promise<Buffer | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      })

      const response = await client.send(command)

      if (!response.Body) {
        return null
      }

      const bodyContents = await response.Body.transformToByteArray()
      return Buffer.from(bodyContents)
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return null
      }
      throw error
    }
  }

  async function downloadObjectAsStream(
    key: string,
    start?: number,
    end?: number
  ): Promise<AsyncIterable<Uint8Array> | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
        Range: buildRangeHeader(start, end)
      })

      const response = await client.send(command)

      if (!response.Body) {
        return null
      }

      return response.Body as AsyncIterable<Uint8Array>
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return null
      }
      throw error
    }
  }

  async function deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key
    })

    await client.send(command)
  }

  async function listObjects(prefix?: string, maxKeys: number = S3_LIST_PAGE_SIZE): Promise<string[]> {
    const keys: string[] = []
    let continuationToken: string | undefined

    while (keys.length < maxKeys) {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: Math.min(maxKeys - keys.length, S3_LIST_PAGE_SIZE),
        ContinuationToken: continuationToken
      })

      const response = await client.send(command)
      const pageKeys =
        response.Contents?.map((obj) => obj.Key).filter((k): k is string => typeof k === 'string' && k.length > 0) || []
      keys.push(...pageKeys)

      if (!response.IsTruncated || !response.NextContinuationToken) {
        break
      }
      continuationToken = response.NextContinuationToken
    }

    return keys.slice(0, maxKeys)
  }

  async function* listObjectsIterable(prefix?: string): AsyncGenerator<string, void, void> {
    let continuationToken: string | undefined
    do {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: S3_LIST_PAGE_SIZE,
        ContinuationToken: continuationToken
      })

      const response = await client.send(command)

      for (const obj of response.Contents ?? []) {
        if (typeof obj.Key === 'string' && obj.Key.length > 0) {
          yield obj.Key
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)
  }

  async function getObjectMetadata(key: string): Promise<{
    contentLength?: number
    contentType?: string
    lastModified?: Date
    eTag?: string
  } | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key
      })

      const response = await client.send(command)

      return {
        contentLength: response.ContentLength,
        contentType: response.ContentType,
        lastModified: response.LastModified,
        eTag: response.ETag
      }
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return null
      }
      throw error
    }
  }

  async function objectExists(key: string): Promise<boolean> {
    const metadata = await getObjectMetadata(key)
    return metadata !== null
  }

  async function multipleObjectsExist(keys: string[]): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}

    for (let i = 0; i < keys.length; i += MULTIPLE_EXISTS_BATCH_SIZE) {
      const batch = keys.slice(i, i + MULTIPLE_EXISTS_BATCH_SIZE)
      await Promise.all(
        batch.map(async (key) => {
          results[key] = await objectExists(key)
        })
      )
    }

    return results
  }

  return {
    uploadObject,
    copyObject,
    downloadObjectAsString,
    downloadObjectAsJson,
    downloadObjectAsBuffer,
    downloadObjectAsStream,
    deleteObject,
    listObjects,
    listObjectsIterable,
    getObjectMetadata,
    objectExists,
    multipleObjectsExist
  }
}
