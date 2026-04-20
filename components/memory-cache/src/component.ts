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

const DEFAULT_MAX_ENTRIES = 10_000

export interface InMemoryCacheOptions {
  /**
   * Maximum number of entries the underlying LRU holds before the oldest
   * are evicted. Useful to raise when using this component as a stand-in
   * for a Redis-backed implementation in a workload that stores more than
   * 10 000 keys. Defaults to 10 000.
   */
  max?: number
}

export function createInMemoryCacheComponent(options: InMemoryCacheOptions = {}): ICacheStorageComponent {
  // No cache-wide default TTL. Per-entry TTLs are applied explicitly at
  // every write site so the memory-cache and Redis implementations of
  // ICacheStorageComponent agree on "no TTL = persistent".
  const cache = new LRUCache<string, any>({
    max: options.max ?? DEFAULT_MAX_ENTRIES
  })

  const randomValue = randomUUID()

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  const component: ICacheStorageComponent = {
    async get<T>(key: string): Promise<T | null> {
      const value = cache.get(key)
      return value !== undefined ? (value as T) : null
    },

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
      // Match Redis SET semantics:
      //  - With a positive TTL: apply it.
      //  - Without (or with 0/negative): write the value with ttl:0, which
      //    in lru-cache means "never expire", matching Redis's behavior
      //    of clearing any previous expire when SET has no EX/PX.
      const ttlMs = ttl && ttl > 0 ? fromSecondsToMilliseconds(ttl) : 0
      cache.set(key, value, { ttl: ttlMs })
    },

    async remove(key: string): Promise<void> {
      cache.delete(key)
    },

    async keys(pattern?: string): Promise<string[]> {
      const allKeys = Array.from(cache.keys()) as string[]
      if (!pattern) return allKeys

      // Convert a Redis-style glob pattern to an anchored regex:
      //  1. Escape every regex metacharacter so `user.id:*` doesn't let `.`
      //     match an arbitrary character.
      //  2. Turn `\*` (escaped glob star) back into `.*`.
      //  3. Anchor with ^…$ so the pattern must match the whole key, not a
      //     substring (previously `user:*` also matched `admin_user:123`).
      const regexSource = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
      const regex = new RegExp(regexSource)
      return allKeys.filter((key: string) => regex.test(key))
    },

    async setInHash<T>(key: string, field: string, value: T, ttlInSecondsForHash?: number): Promise<void> {
      // Read-modify-write on the hash. This block must stay synchronous
      // (no `await` between the get and the set) so concurrent calls on
      // the same key cannot interleave and drop fields.
      //
      // TTL semantics, aligned with the Redis implementation:
      //  - Positive TTL: apply it.
      //  - No TTL (or 0/negative): ttl:0 with noUpdateTTL:true. For a new
      //    key, ttl:0 means "never expire" (matching Redis's "no EXPIRE
      //    issued"). For an existing key, noUpdateTTL:true preserves
      //    whatever TTL is already on the entry.
      const options =
        ttlInSecondsForHash && ttlInSecondsForHash > 0
          ? { ttl: fromSecondsToMilliseconds(ttlInSecondsForHash) }
          : { ttl: 0, noUpdateTTL: true }
      const existing = cache.get(key)
      const base = isPlainObject(existing) ? existing : {}
      cache.set(key, { ...base, [field]: value }, options)
    },

    async getFromHash<T>(key: string, field: string): Promise<T | null> {
      const hash = cache.get(key)
      if (!isPlainObject(hash)) return null
      const value = hash[field]
      return value !== undefined ? (value as T) : null
    },

    async removeFromHash(key: string, field: string): Promise<void> {
      const hash = cache.get(key)
      if (!isPlainObject(hash)) return
      const newHash = { ...hash }
      delete newHash[field]

      if (Object.keys(newHash).length === 0) {
        cache.delete(key)
      } else {
        // Preserve the hash's existing TTL — HDEL in Redis does not
        // affect EXPIRE, so we mustn't silently reset it here either.
        cache.set(key, newHash, { noUpdateTTL: true })
      }
    },

    async getAllHashFields<T>(key: string): Promise<Record<string, T>> {
      const value = cache.get(key)
      // Guard against a caller that previously stored a non-object value
      // under `key` via `set()` — returning the raw value cast as a
      // record would be a type lie.
      return isPlainObject(value) ? (value as Record<string, T>) : {}
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
        // Use `has` rather than comparing `get(key) ?? null` to null: the
        // latter treats a user-stored `null` value as "unlocked" and
        // would silently overwrite it when acquiring.
        if (!cache.has(key)) {
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
      if (cache.get(key) === randomValue) {
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
