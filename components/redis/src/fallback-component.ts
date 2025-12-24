import { LRUCache } from 'lru-cache'
import { randomUUID } from 'crypto'
import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import {
  ICacheStorageComponent,
  DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_RETRIES,
  LockNotAcquiredError,
  LockNotReleasedError,
  sleep
} from '@dcl/core-commons'

const TWENTY_FOUR_HOURS_IN_MILLISECONDS = 1000 * 60 * 60 * 24

interface CacheEntry {
  value: any
  expiresAt?: number
}

interface HashEntry {
  [field: string]: any
}

export function createInMemoryCacheComponent(): ICacheStorageComponent {
  const cache = new LRUCache<string, CacheEntry>({
    max: 1000,
    ttl: TWENTY_FOUR_HOURS_IN_MILLISECONDS
  })
  const hashes = new LRUCache<string, HashEntry>({
    max: 1000,
    ttl: TWENTY_FOUR_HOURS_IN_MILLISECONDS
  })
  const locks = new Map<string, { owner: string; expiresAt: number }>()
  const randomValue = randomUUID()

  async function start() {}

  async function stop() {
    cache.clear()
    hashes.clear()
    locks.clear()
  }

  async function get<T>(key: string): Promise<T | T[] | null> {
    const entry = cache.get(key)
    if (!entry || (entry.expiresAt && entry.expiresAt <= Date.now())) {
      cache.delete(key)
      return null
    }
    return entry.value as T
  }

  async function getByPattern<T>(pattern: string): Promise<T[]> {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      const matchingKeys = [...cache.keys()].filter((key) => regex.test(key))

      const validKeys = matchingKeys.filter((key) => {
        const entry = cache.get(key)
        if (entry && (!entry.expiresAt || entry.expiresAt > Date.now())) {
          return true
        } else {
          cache.delete(key)
          return false
        }
      })

      return validKeys.map((key) => {
        const entry = cache.get(key)
        return entry?.value as T
      }).filter((value) => value !== undefined)
    }

    const entry = cache.get(pattern)
    if (!entry || (entry.expiresAt && entry.expiresAt <= Date.now())) {
      cache.delete(pattern)
      return []
    }
    return [entry.value as T]
  }

  async function set<T>(key: string, value: T, ttlInSeconds?: number): Promise<void> {
    const ttl = ttlInSeconds ? ttlInSeconds * 1000 : TWENTY_FOUR_HOURS_IN_MILLISECONDS
    const expiresAt = Date.now() + ttl
    cache.set(key, { value, expiresAt })
  }

  async function remove(key: string): Promise<void> {
    cache.delete(key)
  }

  async function keys(pattern: string = '*'): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    const allKeys: string[] = []
    
    for (const key of cache.keys()) {
      if (regex.test(key)) {
        const entry = cache.get(key)
        if (entry && (!entry.expiresAt || entry.expiresAt > Date.now())) {
          allKeys.push(key)
        } else {
          cache.delete(key)
        }
      }
    }
    
    return allKeys
  }

  async function setInHash<T>(key: string, field: string, value: T, ttlInSecondsForHash?: number): Promise<void> {
    const hash = hashes.get(key) || {}
    hash[field] = value
    hashes.set(key, hash)
    
    if (ttlInSecondsForHash) {
      // Note: LRUCache doesn't support per-key TTL updates, so we store expiration separately
      // This is a limitation of the in-memory implementation
    }
  }

  async function getFromHash<T>(key: string, field: string): Promise<T | null> {
    const hash = hashes.get(key)
    if (!hash || !(field in hash)) {
      return null
    }
    return hash[field] as T
  }

  async function removeFromHash(key: string, field: string): Promise<void> {
    const hash = hashes.get(key)
    if (hash) {
      delete hash[field]
      if (Object.keys(hash).length === 0) {
        hashes.delete(key)
      } else {
        hashes.set(key, hash)
      }
    }
  }

  async function getAllHashFields<T>(key: string): Promise<Record<string, T>> {
    const hash = hashes.get(key)
    return (hash || {}) as Record<string, T>
  }

  async function acquireLock(
    key: string,
    options?: { ttlInMilliseconds?: number; retryDelayInMilliseconds?: number; retries?: number }
  ): Promise<void> {
    const ttl = options?.ttlInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS
    const retryDelay = options?.retryDelayInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS
    const retries = options?.retries ?? DEFAULT_ACQUIRE_LOCK_RETRIES

    for (let i = 0; i < retries; i++) {
      const existingLock = locks.get(key)
      if (!existingLock || existingLock.expiresAt <= Date.now()) {
        locks.set(key, { owner: randomValue, expiresAt: Date.now() + ttl })
        return
      }
      
      if (i < retries - 1) {
        await sleep(retryDelay)
      }
    }

    throw new LockNotAcquiredError(key)
  }

  async function releaseLock(key: string): Promise<void> {
    const lock = locks.get(key)
    if (lock && lock.owner === randomValue) {
      locks.delete(key)
      return
    }
    throw new LockNotReleasedError(key)
  }

  async function tryAcquireLock(
    key: string,
    options?: { ttlInMilliseconds?: number; retryDelayInMilliseconds?: number; retries?: number }
  ): Promise<boolean> {
    try {
      await acquireLock(key, options)
      return true
    } catch (error) {
      if (error instanceof LockNotAcquiredError) {
        return false
      }
      throw error
    }
  }

  async function tryReleaseLock(key: string): Promise<boolean> {
    try {
      await releaseLock(key)
      return true
    } catch (error) {
      if (error instanceof LockNotReleasedError) {
        return false
      }
      throw error
    }
  }

  return {
    [START_COMPONENT]: start,
    [STOP_COMPONENT]: stop,
    get,
    getByPattern,
    set,
    remove,
    keys,
    setInHash,
    getFromHash,
    removeFromHash,
    getAllHashFields,
    acquireLock,
    releaseLock,
    tryAcquireLock,
    tryReleaseLock
  }
}
