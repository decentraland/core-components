import { LRUCache } from 'lru-cache'
import { randomUUID } from 'crypto'
import {
  ICacheStorageComponent,
  sleep,
  fromSecondsToMilliseconds,
  DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_RETRIES,
  LockNotAcquiredError,
  LockNotReleasedError
} from '@dcl/core-commons'

export function createInMemoryCacheComponent(): ICacheStorageComponent {
  const cache = new LRUCache<string, any>({
    max: 10000,
    ttl: 1000 * 60 * 60 // 1 hour default TTL
  })

  const randomValue = randomUUID()

  const component: ICacheStorageComponent = {
    async get<T>(key: string): Promise<T | null> {
      const value = cache.get(key)
      return value !== undefined ? (value as T) : null
    },

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
      const options = ttl ? { ttl: fromSecondsToMilliseconds(ttl) } : undefined
      cache.set(key, value, options)
    },

    async remove(key: string): Promise<void> {
      cache.delete(key)
    },

    async keys(pattern?: string): Promise<string[]> {
      const allKeys = Array.from(cache.keys()) as string[]
      if (!pattern) return allKeys

      // Simple pattern matching - convert glob-like pattern to regex
      const regexPattern = pattern.replace(/\*/g, '.*')
      const regex = new RegExp(regexPattern)
      return allKeys.filter((key: string) => regex.test(key))
    },

    async setInHash<T>(key: string, field: string, value: T, ttlInSecondsForHash?: number): Promise<void> {
      cache.set(
        key,
        { ...(cache.get(key) ?? {}), [field]: value },
        ttlInSecondsForHash !== undefined ? { ttl: fromSecondsToMilliseconds(ttlInSecondsForHash) } : undefined
      )
    },

    async getFromHash<T>(key: string, field: string): Promise<T | null> {
      return cache.get(key)?.[field] ?? null
    },

    async removeFromHash(key: string, field: string): Promise<void> {
      const hash = cache.get(key)
      if (!hash) return
      const newHash = { ...hash }
      delete newHash[field]

      // If the hash is empty, delete it
      if (Object.keys(newHash).length === 0) {
        cache.delete(key)
      } else {
        cache.set(key, newHash)
      }
    },

    async getAllHashFields<T>(key: string): Promise<Record<string, T>> {
      return cache.get(key) ?? {}
    },

    async acquireLock(
      key: string,
      options?: {
        ttlInMilliseconds?: number
        retryDelayInMilliseconds?: number
        retries?: number
      }
    ): Promise<void> {
      const ttl = options?.ttlInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS
      const retryDelay = options?.retryDelayInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS
      const retries = options?.retries ?? DEFAULT_ACQUIRE_LOCK_RETRIES

      for (let i = 0; i < retries; i++) {
        const lock = cache.get(key) ?? null
        if (lock === null) {
          cache.set(key, randomValue, { ttl })
          return
        }
        if (i < retries - 1) {
          await sleep(retryDelay)
        }
      }

      throw new LockNotAcquiredError(key)
    },

    async releaseLock(key: string): Promise<void> {
      const lock = cache.get(key) ?? null
      if (lock === randomValue) {
        cache.delete(key)
        return
      }
      throw new LockNotReleasedError(key)
    },

    async tryAcquireLock(
      key: string,
      options?: {
        ttlInMilliseconds?: number
        retryDelayInMilliseconds?: number
        retries?: number
      }
    ): Promise<boolean> {
      try {
        await component.acquireLock(key, options)
        return true
      } catch (error) {
        if (error instanceof LockNotAcquiredError) {
          return false
        }
        throw error
      }
    },

    async tryReleaseLock(key: string): Promise<boolean> {
      try {
        await component.releaseLock(key)
        return true
      } catch (error) {
        if (error instanceof LockNotReleasedError) {
          return false
        }
        throw error
      }
    }
  }

  return component
}
