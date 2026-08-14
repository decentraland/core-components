import { LRUCache } from 'lru-cache'
import { randomUUID } from 'crypto'
import {
  ICacheStorageComponent,
  IncrementOptions,
  IncrementResult,
  assertIntegerCounter,
  assertValidIncrementOptions,
  sleep,
  fromSecondsToMilliseconds,
  DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_RETRIES,
  LockNotAcquiredError,
  LockNotReleasedError
} from '@dcl/core-commons'

export type InMemoryCacheOptions = {
  /** Maximum number of items the cache will hold. Must be a positive integer. Defaults to 10_000. */
  max?: number
  /**
   * Default TTL in **milliseconds** applied to every entry. When omitted, defaults to one hour.
   * Pass `0` to disable TTL entirely so entries live until evicted by the LRU cap. Must not be negative.
   *
   * Note: the per-call `ttl` argument on `set(key, value, ttl)` is interpreted in **seconds** (it goes
   * through `fromSecondsToMilliseconds`); only this constructor option is in milliseconds.
   */
  ttl?: number
}

export const DEFAULT_MAX = 10_000
export const DEFAULT_TTL_MS = 1000 * 60 * 60

export function createInMemoryCacheComponent(options?: InMemoryCacheOptions): ICacheStorageComponent {
  const max = options?.max ?? DEFAULT_MAX
  const ttl = options?.ttl ?? DEFAULT_TTL_MS

  if (!Number.isInteger(max) || max < 1) {
    throw new TypeError(`createInMemoryCacheComponent: "max" must be a positive integer, got ${options?.max}`)
  }
  if (!Number.isFinite(ttl) || ttl < 0) {
    throw new TypeError(
      `createInMemoryCacheComponent: "ttl" must be a non-negative finite number of milliseconds, got ${options?.ttl}`
    )
  }

  const cache = new LRUCache<string, any>(ttl > 0 ? { max, ttl } : { max })

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

    async exists(key: string): Promise<boolean> {
      // `LRUCache.has` returns false for expired entries and (by default) does
      // not refresh the LRU position, so the call is read-only with respect to
      // both expiry and recency — exactly what an existence check should be.
      return cache.has(key)
    },

    async keys(pattern?: string): Promise<string[]> {
      const allKeys = Array.from(cache.keys()) as string[]
      if (!pattern) return allKeys

      // Convert a glob-like pattern to a regex. Escape every regex metacharacter
      // first so a caller-supplied pattern can't inject regex syntax (avoiding
      // ReDoS), then turn the escaped `*` globs back into `.*` wildcards, and
      // anchor with `^`/`$` so the pattern matches the whole key rather than a
      // substring.
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`)
      return allKeys.filter((key: string) => regex.test(key))
    },

    async increment(key: string, options?: IncrementOptions): Promise<IncrementResult> {
      const { amount, ttlInSeconds } = assertValidIncrementOptions(options)

      // Read-modify-write with no `await` between the read and the write. JavaScript cannot
      // interleave another task inside a synchronous block, so this is atomic by construction for
      // every caller in this process. DO NOT introduce an `await` (or any other suspension point)
      // between the `get` and the `set` — that reopens the lost-update race this method exists to
      // close. `async` only defers the returned promise; the body runs to completion first.
      const current = cache.get(key)
      // Not `typeof current === 'number'`: `NaN`, `±Infinity` and fractional values are all numbers,
      // and incrementing them produces a counter that never crosses a threshold again. `NaN + 1` is
      // `NaN`, so a single poisoned key would make a limiter fail open forever — silently.
      if (current !== undefined) {
        assertIntegerCounter(current)
      }
      const value = current === undefined ? amount : current + amount

      // Whether the entry already has a deadline decides between "leave it alone" and "apply the
      // requested one", so it has to be read *before* the write. `Infinity` is lru-cache's "no
      // expiry"; a missing key reports `0`, which is harmless here because lru-cache forces
      // `noUpdateTTL` off when *adding* an entry, so a new counter always gets its TTL either way.
      const hasExpiry = Number.isFinite(cache.getRemainingTTL(key))

      // `noUpdateTTL` keeps an existing deadline intact, which is what stops every increment from
      // sliding the window — including sliding the constructor's default TTL when no per-call TTL is
      // given. It is deliberately dropped for a counter that has no deadline at all while a TTL was
      // requested: that is the repair case, and leaving the flag on would keep an immortal counter
      // immortal forever, diverging from the Redis backend (`PTTL < 0` there) and from the documented
      // contract. Mirrors Redis in only repairing when a TTL was actually passed.
      cache.set(key, value, {
        noUpdateTTL: hasExpiry || ttlInSeconds === undefined,
        ...(ttlInSeconds !== undefined ? { ttl: fromSecondsToMilliseconds(ttlInSeconds) } : {})
      })

      // Read again after the write: lru-cache installs the real `getRemainingTTL` lazily when TTL
      // tracking is first initialized, so the pre-write read can come from the stub.
      const remaining = cache.getRemainingTTL(key)
      return {
        value,
        // Rounded up to whole milliseconds: lru-cache derives this from `performance.now()` and hands
        // back a sub-millisecond float (`59999.964333`), where Redis reports an integer. Without this
        // the two backends disagree on the type of a documented public field, and a consumer piping it
        // into a header emits an invalid `Retry-After`. Ceiling matches the direction Redis rounds on
        // the way in, and keeps a counter with <1ms left from reporting `0`.
        ttlRemainingInMilliseconds: Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining)) : undefined
      }
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
