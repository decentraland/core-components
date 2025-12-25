// Shared types for core components
import { IBaseComponent } from '@well-known-components/interfaces'

export interface ASharedType {
  a: string
}

export interface ICacheStorageComponent extends IBaseComponent {
  /**
   * Retrieves a value from cache by key.
   * @param key - The key to look up.
   * @returns Promise resolving to the cached value or null if not found.
   */
  get<T>(key: string): Promise<T | null>
  /**
   * Stores a value in cache by key.
   * @param key - The key to store the value under.
   * @param value - The value to store.
   * @param ttl - Optional time-to-live in seconds.
   */
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  /**
   * Removes a value from cache.
   * @param key - The key to remove.
   */
  remove(key: string): Promise<void>
  /**
   * Retrieves all keys from cache.
   * @returns Promise resolving to an array of all keys.
   */
  keys(pattern?: string): Promise<string[]>
  /**
   * Stores a value in a hash by key and field.
   * @param key - The key where the hash is stored.
   * @param field - The field to store the value under.
   * @param value - The value to store.
   * @param ttlInSecondsForHash - Optional time-to-live in seconds for the hash.
   */
  setInHash<T>(key: string, field: string, value: T, ttlInSecondsForHash?: number): Promise<void>
  /**
   * Retrieves a value from a hash by key and field.
   * @param key - The key where the hash is stored.
   * @param field - The field to look up.
   * @returns Promise resolving to the cached value or null if not found.
   */
  getFromHash<T>(key: string, field: string): Promise<T | null>
  /**
   * Removes a value from a hash by key and field. If the hash is empty, it will be deleted.
   * @param key - The key where the hash is stored.
   * @param field - The field to remove.
   */
  removeFromHash(key: string, field: string): Promise<void>
  /**
   * Retrieves all fields from a hash by key.
   * @param key - The key to look up.
   * @returns Promise resolving to an object with all fields and their values.
   */
  getAllHashFields<T>(key: string): Promise<Record<string, T>>

  /**
   * Acquires a lock for a key. Throws LockNotAcquiredError if lock cannot be acquired.
   * @param key - The key to acquire the lock for.
   * @param options - Lock options including TTL, retry delay, and number of retries.
   * @param options.ttlInMilliseconds - Time-to-live for the lock in milliseconds. Default: 10000 (10 seconds).
   * @param options.retryDelayInMilliseconds - Delay between retries in milliseconds. Default: 200.
   * @param options.retries - Number of retry attempts. Default: 10.
   * @throws {LockNotAcquiredError} When the lock cannot be acquired after all retries.
   */
  acquireLock(
    key: string,
    options?: { ttlInMilliseconds?: number; retryDelayInMilliseconds?: number; retries?: number }
  ): Promise<void>
  /**
   * Releases a lock for a key. Throws LockNotReleasedError if lock cannot be released.
   * @param key - The key to release the lock for.
   * @throws {LockNotReleasedError} When the lock cannot be released (not owned by this instance).
   */
  releaseLock(key: string): Promise<void>
  /**
   * Attempts to acquire a lock for a key without throwing errors.
   * @param key - The key to acquire the lock for.
   * @param options - Lock options including TTL, retry delay, and number of retries.
   * @param options.ttlInMilliseconds - Time-to-live for the lock in milliseconds. Default: 10000 (10 seconds).
   * @param options.retryDelayInMilliseconds - Delay between retries in milliseconds. Default: 200.
   * @param options.retries - Number of retry attempts. Default: 10.
   * @returns Promise resolving to true if lock was acquired, false otherwise.
   */
  tryAcquireLock(
    key: string,
    options?: { ttlInMilliseconds?: number; retryDelayInMilliseconds?: number; retries?: number }
  ): Promise<boolean>
  /**
   * Attempts to release a lock for a key without throwing errors.
   * @param key - The key to release the lock for.
   * @returns Promise resolving to true if the lock was released, false otherwise.
   */
  tryReleaseLock(key: string): Promise<boolean>
}

// Queue component types

/**
 * Options for receiving messages from a queue.
 */
export type ReceiveMessagesOptions = {
  visibilityTimeout?: number
  waitTimeSeconds?: number
  abortSignal?: AbortSignal
}

/**
 * The status of a queue.
 */
export type QueueStatus = {
  ApproximateNumberOfMessages: string
  ApproximateNumberOfMessagesNotVisible: string
  ApproximateNumberOfMessagesDelayed: string
}

/**
 * The interface for a queue component.
 */
export interface IQueueComponent {
  /**
   * Sends a message to the queue.
   * @param message - The message to send.
   */
  sendMessage(message: any): Promise<void>
  /**
   * Receives messages from the queue.
   * @param amount - The number of messages to receive.
   * @param options - The options for receiving messages.
   * @returns A promise that resolves to an array of messages.
   */
  receiveMessages(amount?: number, options?: ReceiveMessagesOptions): Promise<any[]>
  /**
   * Deletes a message from the queue.
   * @param receiptHandle - The receipt handle of the message to delete.
   */
  deleteMessage(receiptHandle: string): Promise<void>
  /**
   * Deletes multiple messages from the queue.
   * @param receiptHandles - The receipt handles of the messages to delete.
   */
  deleteMessages(receiptHandles: string[]): Promise<void>
  /**
   * Changes the visibility timeout of a message.
   * @param receiptHandle - The receipt handle of the message to change the visibility timeout of.
   * @param visibilityTimeout - The new visibility timeout in seconds.
   */
  changeMessageVisibility(receiptHandle: string, visibilityTimeout: number): Promise<void>
  /**
   * Changes the visibility timeout of multiple messages.
   * @param receiptHandles - The receipt handles of the messages to change the visibility timeout of.
   * @param visibilityTimeout - The new visibility timeout in seconds.
   */
  changeMessagesVisibility(receiptHandles: string[], visibilityTimeout: number): Promise<void>
  /**
   * Gets the status of the queue.
   * @returns A promise that resolves to the status of the queue.
   */
  getStatus(): Promise<QueueStatus>
}
