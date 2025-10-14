export interface IS3Component {
  /**
   * Uploads an object to S3.
   * @param key - The key (path) where the object will be stored.
   * @param body - The content to upload (string, Buffer, or stream).
   * @param contentType - Optional content type (MIME type).
   * @returns Promise resolving to the upload result with ETag.
   */
  uploadObject(key: string, body: string | Buffer, contentType?: string): Promise<{ ETag?: string }>

  /**
   * Downloads an object from S3.
   * @param key - The key (path) of the object to download.
   * @returns Promise resolving to the object content as a string, or null if not found.
   */
  downloadObject(key: string): Promise<string | null>

  /**
   * Deletes an object from S3.
   * @param key - The key (path) of the object to delete.
   * @returns Promise resolving when the object is deleted.
   */
  deleteObject(key: string): Promise<void>

  /**
   * Lists objects in the bucket with an optional prefix.
   * @param prefix - Optional prefix to filter objects.
   * @param maxKeys - Maximum number of keys to return (default: 1000).
   * @returns Promise resolving to an array of object keys.
   */
  listObjects(prefix?: string, maxKeys?: number): Promise<string[]>

  /**
   * Gets metadata for an object.
   * @param key - The key (path) of the object.
   * @returns Promise resolving to object metadata or null if not found.
   */
  getObjectMetadata(key: string): Promise<{
    ContentLength?: number
    ContentType?: string
    LastModified?: Date
    ETag?: string
  } | null>

  /**
   * Checks if an object exists in S3.
   * @param key - The key (path) of the object.
   * @returns Promise resolving to true if the object exists, false otherwise.
   */
  objectExists(key: string): Promise<boolean>

  /**
   * Checks if multiple objects exist in S3.
   * @param keys - Array of keys (paths) to check.
   * @returns Promise resolving to an object mapping each key to its existence status.
   */
  multipleObjectsExist(keys: string[]): Promise<Record<string, boolean>>
}

