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
