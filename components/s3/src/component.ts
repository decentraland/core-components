import { IConfigComponent } from '@well-known-components/interfaces'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand
} from '@aws-sdk/client-s3'

import { IS3Component } from './types'

/**
 * Helper function to check if an error is a "not found" error from S3
 */
function isNotFoundError(error: any): boolean {
  return (
    error.name === 'NoSuchKey' ||
    error.name === 'NotFound' ||
    error.$metadata?.httpStatusCode === 404
  )
}

export async function createS3Component({ config }: { config: IConfigComponent }): Promise<IS3Component> {
  const bucketName = await config.requireString('AWS_S3_BUCKET_NAME')
  const optionalEndpoint = await config.getString('AWS_S3_ENDPOINT')
  const region = await config.getString('AWS_REGION')

  const client = new S3Client({
    endpoint: optionalEndpoint || undefined,
    region: region || undefined,
    forcePathStyle: !!optionalEndpoint // Required for LocalStack/MinIO
  })

  async function uploadObject(
    key: string,
    body: string | Buffer,
    contentType?: string
  ): Promise<{ ETag?: string }> {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType
    })

    const response = await client.send(command)
    return { ETag: response.ETag }
  }

  async function downloadObject(key: string): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      })

      const response = await client.send(command)

      if (!response.Body) {
        return null
      }

      // Convert stream to string
      const bodyContents = await response.Body.transformToString()
      return bodyContents
    } catch (error: any) {
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

  async function listObjects(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys
    })

    const response = await client.send(command)
    return response.Contents?.map((obj) => obj.Key || '').filter((key) => key !== '') || []
  }

  async function getObjectMetadata(key: string): Promise<{
    ContentLength?: number
    ContentType?: string
    LastModified?: Date
    ETag?: string
  } | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key
      })

      const response = await client.send(command)

      return {
        ContentLength: response.ContentLength,
        ContentType: response.ContentType,
        LastModified: response.LastModified,
        ETag: response.ETag
      }
    } catch (error: any) {
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

    // Check all objects in parallel
    await Promise.all(
      keys.map(async (key) => {
        results[key] = await objectExists(key)
      })
    )

    return results
  }

  return {
    uploadObject,
    downloadObject,
    deleteObject,
    listObjects,
    getObjectMetadata,
    objectExists,
    multipleObjectsExist
  }
}

