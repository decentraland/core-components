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
   * Removes a value from a hash by key and field.
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
}
