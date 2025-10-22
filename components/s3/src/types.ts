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
   * Downloads an object from S3 as a string.
   * Best for: JSON, text files, small content
   * WARNING: Loads entire file into memory
   * @param key - The key (path) of the object to download.
   * @returns Promise resolving to the object content as a string, or null if not found.
   */
  downloadObjectAsString(key: string): Promise<string | null>

  /**
   * Downloads and parses a JSON object from S3.
   * Best for: JSON configuration files, small JSON data
   * @param key - The key (path) of the JSON object to download.
   * @returns Promise resolving to the parsed JSON object, or null if not found.
   */
  downloadObjectAsJson<T = any>(key: string): Promise<T | null>

  /**
   * Downloads an object from S3 as a Buffer.
   * Best for: Images, PDFs, binary files, medium-sized content
   * WARNING: Loads entire file into memory
   * @param key - The key (path) of the object to download.
   * @returns Promise resolving to the object content as a Buffer, or null if not found.
   */
  downloadObjectAsBuffer(key: string): Promise<Buffer | null>

  /**
   * Downloads an object from S3 as a stream.
   * Best for: Large files, memory-constrained environments, processing data incrementally
   * @param key - The key (path) of the object to download.
   * @param start - Optional start byte position for partial downloads.
   * @param end - Optional end byte position for partial downloads.
   * @returns Promise resolving to an AsyncIterable<Uint8Array> stream, or null if not found.
   */
  downloadObjectAsStream(key: string, start?: number, end?: number): Promise<AsyncIterable<Uint8Array> | null>

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
    contentLength?: number
    contentType?: string
    lastModified?: Date
    eTag?: string
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

