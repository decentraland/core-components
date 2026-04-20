import { LRUCache } from 'lru-cache'
import { randomUUID } from 'crypto'
import { setTimeout as sleepWithSignal } from 'timers/promises'
import { ILoggerComponent } from '@well-known-components/interfaces'
import {
  AcquireLockOptions,
  ICacheStorageComponent,
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
  /**
   * Optional logger component. If provided, lock acquire / release
   * debug lines are emitted alongside the Redis component's, so a
   * memory-backed drop-in is symmetric on observability.
   */
  logs?: ILoggerComponent
}

// Throws the AbortSignal's reason (or a fresh AbortError) if the signal
// is already aborted. Used at the top of the retry loop and before each
// attempt so a caller that cancels mid-contention doesn't have to wait
// for the next wake-up tick.
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  }
}

function validateLockOptions(options?: AcquireLockOptions): void {
  if (options?.retries !== undefined) {
    if (!Number.isInteger(options.retries) || options.retries < 0) {
      throw new TypeError(
        `acquireLock 'retries' must be a non-negative integer, got ${String(options.retries)}`
      )
    }
  }
  if (options?.retryDelayInMilliseconds !== undefined) {
    if (!Number.isFinite(options.retryDelayInMilliseconds) || options.retryDelayInMilliseconds < 0) {
      throw new TypeError(
        `acquireLock 'retryDelayInMilliseconds' must be a non-negative finite number, got ${String(
          options.retryDelayInMilliseconds
        )}`
      )
    }
  }
  if (options?.ttlInMilliseconds !== undefined && !Number.isFinite(options.ttlInMilliseconds)) {
    throw new TypeError(
      `acquireLock 'ttlInMilliseconds' must be a finite number, got ${String(options.ttlInMilliseconds)}`
    )
  }
}

// Translate a Redis-style glob pattern into an anchored regex. Supports
// `*` (any run), `?` (any single char), `[...]` character classes with
// `!` negation, and `\` as a literal escape for the next character.
// Everything else is regex-escaped so it matches literally.
function compileGlob(pattern: string): RegExp {
  const regexMetas = '.+^${}()|\\/'
  const escapables = regexMetas + '*?[]-'
  let out = '^'
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i]
    if (ch === '*') {
      out += '.*'
      i++
      continue
    }
    if (ch === '?') {
      out += '.'
      i++
      continue
    }
    if (ch === '[') {
      // Scan ahead for the closing ']'. A ']' immediately after '[' or
      // '[!' is treated as a literal member of the class (POSIX-style),
      // so start the search one position later in that case.
      let j = i + 1
      if (j < pattern.length && (pattern[j] === '!' || pattern[j] === '^')) j++
      if (j < pattern.length && pattern[j] === ']') j++
      while (j < pattern.length && pattern[j] !== ']') j++
      if (j >= pattern.length) {
        // Unclosed '[' — treat as literal bracket.
        out += '\\['
        i++
        continue
      }
      const raw = pattern.slice(i + 1, j)
      const classBody = raw.startsWith('!') ? '^' + raw.slice(1) : raw
      out += '[' + classBody + ']'
      i = j + 1
      continue
    }
    if (ch === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1]
      out += escapables.includes(next) ? '\\' + next : next
      i += 2
      continue
    }
    out += regexMetas.includes(ch) ? '\\' + ch : ch
    i++
  }
  out += '$'
  return new RegExp(out)
}

export function createInMemoryCacheComponent(options: InMemoryCacheOptions = {}): ICacheStorageComponent {
  // No cache-wide default TTL. Per-entry TTLs are applied explicitly at
  // every write site so the memory-cache and Redis implementations of
  // ICacheStorageComponent agree on "no TTL = persistent".
  const cache = new LRUCache<string, any>({
    max: options.max ?? DEFAULT_MAX_ENTRIES
  })

  const logger = options.logs?.getLogger('memory-cache-component')
  const randomValue = randomUUID()

  // Accepts only plain JS objects (no arrays, Maps, Sets, Dates, class
  // instances, etc.) — anything else is type-unsafe to treat as a hash.
  function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
  }

  // Redis's WRONGTYPE equivalent — thrown when a caller tries a hash
  // operation on a key that holds a non-object value (e.g. a string
  // written via `set()`). Matching Redis's reaction here keeps the two
  // implementations of ICacheStorageComponent interchangeable.
  function assertHashCompatible(key: string, existing: unknown, op: string): void {
    if (existing !== undefined && !isPlainObject(existing)) {
      throw new Error(
        `Cannot ${op} on key "${key}" — it holds a non-object value. Remove the key first or pick a different key.`
      )
    }
  }

  // Returns a hash-storage object we can safely mutate with bracket
  // assignment. If the incoming value is an Object.prototype-chained
  // plain object (from an older write, or from a caller seeding the
  // key via `set()` with `{foo: 1}`), its contents are migrated onto
  // a fresh null-prototype object; subsequent writes are then free of
  // the `__proto__` setter hazard (`target['__proto__'] = v` on a
  // regular object rewrites the prototype instead of storing an own
  // property).
  function normaliseHashStorage(existing: unknown): Record<string, unknown> {
    if (existing === undefined || !isPlainObject(existing)) {
      return Object.create(null) as Record<string, unknown>
    }
    if (Object.getPrototypeOf(existing) === null) {
      return existing
    }
    const migrated: Record<string, unknown> = Object.create(null)
    for (const ownField of Object.keys(existing)) {
      migrated[ownField] = existing[ownField]
    }
    return migrated
  }

  const component: ICacheStorageComponent = {
    async get<T>(key: string): Promise<T | null> {
      const value = cache.get(key)
      return value !== undefined ? (value as T) : null
    },

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
      // Mirror Redis: `SET` cannot carry an `undefined` value. Catching
      // this here avoids lru-cache's "undefined = delete" semantics,
      // which diverges from the Redis implementation (which would error
      // out on the wire before storing anything).
      if (value === undefined) {
        throw new Error(`Cannot set an undefined value for key "${key}".`)
      }
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
      // Short-circuit the no-pattern and match-all cases — materialising
      // the iterator once is the best we can do for those. An explicit
      // empty string is NOT a match-all: Redis's `SCAN MATCH ''` would
      // match nothing (only an empty-string key), so let it fall through
      // and compile to an anchored `^$` regex.
      if (pattern === undefined || pattern === '*') {
        return Array.from(cache.keys()) as string[]
      }

      // Full Redis-style glob: `*`, `?`, `[...]` (with `!`/`^`
      // negation), and `\` as a literal escape. Everything else is
      // regex-escaped. Anchored with ^…$ so `user:*` only matches
      // keys that actually start with `user:`.
      const regex = compileGlob(pattern)
      // One-pass filter over the iterator — no intermediate Array.from
      // allocation for a cache whose size can run into the tens of
      // thousands when the pattern only matches a handful of keys.
      const result: string[] = []
      for (const key of cache.keys() as IterableIterator<string>) {
        if (regex.test(key)) result.push(key)
      }
      return result
    },

    async setInHash<T>(key: string, field: string, value: T, ttlInSecondsForHash?: number): Promise<void> {
      // Mirror Redis: HSET cannot carry an `undefined` value. The previous
      // spread would store `{ [field]: undefined }`, and getFromHash
      // would then report `null` — a silent write-then-read discrepancy
      // that no Redis-backed call would ever exhibit.
      if (value === undefined) {
        throw new Error(`Cannot setInHash an undefined value under key "${key}", field "${field}".`)
      }
      // Read-modify-write on the hash. This block must stay synchronous
      // (no `await` between the get and the set) so concurrent calls on
      // the same key cannot interleave and drop fields.
      //
      // TTL semantics, aligned with the Redis implementation:
      //  - Positive TTL: apply it.
      //  - No TTL (or 0/negative): ttl:0 with noUpdateTTL:true. For a new
      //    key, ttl:0 means "never expire" (matching Redis's "no EXPIRE
      //    issued"). For an existing key, noUpdateTTL:true preserves
      //    whatever TTL is already on the entry — `ttl:0` is the
      //    operative instruction only on the new-key path.
      const options =
        ttlInSecondsForHash && ttlInSecondsForHash > 0
          ? { ttl: fromSecondsToMilliseconds(ttlInSecondsForHash) }
          : { ttl: 0, noUpdateTTL: true }
      const existing = cache.get(key)
      assertHashCompatible(key, existing, 'setInHash')
      // Mutate in place. Redis HSET is O(1); the previous spread-based
      // version was O(fields) per call. Safe because getAllHashFields
      // and getFromHash return shallow clones / single values, so
      // callers cannot hold a reference that observes this mutation.
      //
      // The storage uses a null-prototype object so that mutating
      // assignments like `hash['__proto__'] = value` write an own
      // property instead of invoking the Object.prototype __proto__
      // setter (which would clobber the prototype and break subsequent
      // reads). Existing Object.prototype-chained hashes (from an older
      // write, or from a caller who seeded the key via `set()` with a
      // plain literal) are migrated on first write.
      const target = normaliseHashStorage(existing)
      target[field] = value
      cache.set(key, target, options)
    },

    async getFromHash<T>(key: string, field: string): Promise<T | null> {
      const hash = cache.get(key)
      if (!isPlainObject(hash)) return null
      // hasOwnProperty guard: `hash[field]` without this would return
      // Object.prototype for field === '__proto__', or the constructor
      // function for field === 'constructor'. We only want to expose
      // values the caller explicitly stored.
      if (!Object.prototype.hasOwnProperty.call(hash, field)) return null
      const value = hash[field]
      return value !== undefined ? (value as T) : null
    },

    async removeFromHash(key: string, field: string): Promise<void> {
      const existing = cache.get(key)
      if (!isPlainObject(existing)) return
      // Normalise to a null-prototype object so a subsequent delete of
      // a prototype-shaped field name (e.g. '__proto__') removes an own
      // property rather than silently doing nothing on the base object.
      const target = normaliseHashStorage(existing)
      delete target[field]

      if (Object.keys(target).length === 0) {
        cache.delete(key)
      } else {
        // Preserve the hash's existing TTL — HDEL in Redis does not
        // touch EXPIRE, so we mustn't silently reset it here either.
        cache.set(key, target, { noUpdateTTL: true })
      }
    },

    async getAllHashFields<T>(key: string): Promise<Record<string, T>> {
      const value = cache.get(key)
      // Guard against a caller that previously stored a non-object value
      // under `key` via `set()` — returning the raw value cast as a
      // record would be a type lie. And even for plain-object hashes,
      // return a shallow clone: the underlying entry is mutated
      // in-place by setInHash / removeFromHash, so handing the live
      // reference back would leak cache mutations to the caller (and
      // vice-versa).
      return isPlainObject(value) ? { ...(value as Record<string, T>) } : {}
    },

    async acquireLock(key: string, options?: AcquireLockOptions): Promise<void> {
      validateLockOptions(options)
      throwIfAborted(options?.signal)

      // Clamp non-positive TTL to the default. With `{ ttl: 0 }`, lru-cache
      // creates a never-expiring entry — here that would mean a lock that
      // silently leaks forever, which is never what the caller meant.
      const requestedTtl = options?.ttlInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS
      const ttl = requestedTtl > 0 ? requestedTtl : DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS
      const retryDelay = options?.retryDelayInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS
      const retries = options?.retries ?? DEFAULT_ACQUIRE_LOCK_RETRIES

      for (let i = 0; i < retries; i++) {
        // Use `cache.get(key) === undefined` rather than `cache.has(key)`:
        //  - `get` refreshes recency so the held lock cannot be evicted
        //    by the LRU when other entries fill the cache (a real hazard
        //    with the configurable `max`). `has` does NOT refresh.
        //  - `=== undefined` still distinguishes "absent" from "stored
        //    null"; `cache.get` returns undefined only for the former.
        if (cache.get(key) === undefined) {
          cache.set(key, randomValue, { ttl })
          logger?.debug('Successfully acquired lock', { key })
          return
        }
        logger?.debug('Could not acquire lock', { key })
        if (i < retries - 1) {
          // Interruptible sleep: `timers/promises#setTimeout` rejects
          // with the signal's reason the moment abort fires, so the
          // caller doesn't have to wait for the next wake-up tick.
          await sleepWithSignal(retryDelay, undefined, { signal: options?.signal })
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

    async tryAcquireLock(key: string, options?: AcquireLockOptions): Promise<boolean> {
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
