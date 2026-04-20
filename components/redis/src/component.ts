import { ILoggerComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { createClient, RedisClientType } from 'redis'
import { randomUUID } from 'crypto'
import {
  ICacheStorageComponent,
  isErrorWithMessage,
  sleep,
  DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_RETRIES,
  LockNotAcquiredError,
  LockNotReleasedError
} from '@dcl/core-commons'

function errorMessageOf(err: unknown): string {
  return isErrorWithMessage(err) ? err.message : 'Unknown error'
}

function errorLogPayload(err: unknown): { error: string; stack?: string } {
  const payload: { error: string; stack?: string } = { error: errorMessageOf(err) }
  if (err instanceof Error && typeof err.stack === 'string') {
    payload.stack = err.stack
  }
  return payload
}

// Strip any user-info (username / password) from a Redis connection URL
// before logging it. Managed Redis providers commonly hand out URLs of
// the form `redis://default:password@host:6379`; without redaction the
// password would be visible in debug logs.
function redactHostUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username) parsed.username = '***'
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return '[unparseable redis url]'
  }
}

// Atomically verify ownership and release a lock. Kept at module scope
// so SCRIPT LOAD / EVALSHA caching can reuse the exact same source
// bytes across every call.
const LOCK_RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end`

export async function createRedisComponent(
  hostUrl: string,
  components: { logs: ILoggerComponent }
): Promise<ICacheStorageComponent> {
  const { logs } = components
  const logger = logs.getLogger('redis-component')
  const randomValue = randomUUID()

  const redactedHostUrl = redactHostUrl(hostUrl)
  const client: RedisClientType = createClient({ url: hostUrl })

  // Cached SHA1 of LOCK_RELEASE_SCRIPT, populated the first time
  // releaseLock is called successfully. Sending the 40-byte hash via
  // EVALSHA is cheaper on the wire than re-transmitting the full
  // script every time, and Redis's internal cache is addressed by
  // exactly that SHA regardless of whether we loaded it explicitly or
  // implicitly via EVAL.
  let lockReleaseScriptSha: string | undefined

  // Connection lifecycle observability. The node-redis client emits
  // 'error', 'reconnecting', 'ready', 'end'; only 'error' was wired up
  // before, so reconnects and closures were invisible in the logs.
  client.on('error', (err: Error) => {
    logger.error('Redis client error', errorLogPayload(err))
  })
  client.on('reconnecting', () => {
    logger.debug('Redis client reconnecting')
  })
  client.on('ready', () => {
    logger.debug('Redis client ready')
  })
  client.on('end', () => {
    logger.debug('Redis client connection ended')
  })

  // Gate concurrent start() callers onto the same connect promise.
  // The previous `if (client.isOpen) return` only protected against
  // SEQUENTIAL double-starts — two concurrent callers would both see
  // `isOpen: false` before the first connect resolved and the second
  // connect would throw "Socket already opened".
  let startPromise: Promise<void> | null = null

  async function start(): Promise<void> {
    if (client.isOpen) return
    if (startPromise) return startPromise
    startPromise = (async () => {
      try {
        logger.debug('Connecting to Redis', { hostUrl: redactedHostUrl })
        await client.connect()
        logger.debug('Successfully connected to Redis')
      } catch (err) {
        logger.error('Error connecting to Redis', errorLogPayload(err))
        throw err
      } finally {
        // Clear the gate in both success and failure so a caller can
        // retry start() after a connect error.
        startPromise = null
      }
    })()
    return startPromise
  }

  async function stop() {
    // Stop is best-effort: a disconnect failure should not prevent the
    // lifecycle manager from moving on with the rest of the shutdown.
    // Skip entirely if the client never opened (start failed, or stop is
    // being called twice) — close() throws in that state.
    if (!client.isOpen) {
      return
    }
    try {
      logger.debug('Disconnecting from Redis')
      await client.close()
      logger.debug('Successfully disconnected from Redis')
    } catch (err) {
      logger.error('Error disconnecting from Redis', errorLogPayload(err))
    }
  }

  async function get<T>(key: string): Promise<T | null> {
    try {
      const serializedValue = await client.get(key)
      // Explicit null/undefined check rather than truthy: `JSON.stringify('')`
      // yields `'""'` (truthy), so an externally-written raw empty string
      // is a malformed value and would throw during parse — no need to
      // silently swallow it as "not found".
      if (serializedValue === null || serializedValue === undefined) {
        return null
      }
      return JSON.parse(serializedValue) as T
    } catch (err) {
      logger.error('Error getting key', { key, ...errorLogPayload(err) })
      throw err
    }
  }

  async function set<T>(key: string, value: T, ttlInSeconds?: number): Promise<void> {
    // Reject undefined at the component boundary: `JSON.stringify(undefined)`
    // returns `undefined` (the value), which node-redis then sends as
    // an empty argument — behavior varies by version and typically
    // throws a TypeError after the wire round-trip. A clear synchronous
    // error is friendlier and matches the memory-cache implementation.
    if (value === undefined) {
      throw new Error(`Cannot set an undefined value for key "${key}".`)
    }
    try {
      const serializedValue = JSON.stringify(value)
      // Only include EX when a positive TTL was provided. Passing
      // `{ EX: undefined }` is interpreted inconsistently across
      // node-redis versions.
      const options = ttlInSeconds && ttlInSeconds > 0 ? { EX: ttlInSeconds } : undefined
      await client.set(key, serializedValue, options)
    } catch (err) {
      logger.error('Error setting key', { key, ...errorLogPayload(err) })
      throw err
    }
  }

  async function acquireLock(
    key: string,
    options?: { ttlInMilliseconds?: number; retryDelayInMilliseconds?: number; retries?: number }
  ): Promise<void> {
    // Clamp non-positive TTL to the default. Redis would reject `PX: 0`
    // at the wire with "invalid expire time in set", but surfacing that
    // as a LockNotAcquiredError further down the line is confusing —
    // bump the unit back to a usable value here instead.
    const requestedTtl = options?.ttlInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS
    const ttlInMilliseconds = requestedTtl > 0 ? requestedTtl : DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS
    const retryDelay = options?.retryDelayInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS
    const retries = options?.retries ?? DEFAULT_ACQUIRE_LOCK_RETRIES

    for (let i = 0; i < retries; i++) {
      // PX takes milliseconds; the previous code used EX (seconds), which
      // made every default-10s lock actually last 10_000s.
      const lock = await client.set(key, randomValue, { NX: true, PX: ttlInMilliseconds })
      if (lock) {
        logger.debug('Successfully acquired lock', { key })
        return
      }
      logger.debug('Could not acquire lock', { key })
      if (i < retries - 1) {
        // Equal-jitter retry: sleep somewhere in [retryDelay/2, retryDelay).
        // Pure fixed delays phase-lock concurrent consumers onto the
        // same wake-up tick and they all retry simultaneously; jitter
        // spreads them out while keeping a predictable floor. Math.floor
        // over the whole sum keeps the result an integer ms even when
        // retryDelay is odd.
        const jitteredDelay = Math.floor(retryDelay / 2 + Math.random() * (retryDelay / 2))
        await sleep(jitteredDelay)
      }
    }

    throw new LockNotAcquiredError(key)
  }

  async function evalLockRelease(key: string): Promise<number> {
    const args = { keys: [key], arguments: [randomValue] }
    // Fast path: use the cached SHA. If the server has since flushed
    // its script cache (SCRIPT FLUSH, restart, failover), Redis
    // replies with a NOSCRIPT error — fall through to EVAL, which
    // re-registers the script server-side and can capture the SHA
    // again for future calls.
    if (lockReleaseScriptSha !== undefined) {
      try {
        return (await client.evalSha(lockReleaseScriptSha, args)) as number
      } catch (err) {
        if (!(isErrorWithMessage(err) && /NOSCRIPT/.test(err.message))) {
          throw err
        }
        lockReleaseScriptSha = undefined
      }
    }
    const result = (await client.eval(LOCK_RELEASE_SCRIPT, args)) as number
    // Best-effort SCRIPT LOAD so the next call can use EVALSHA. Done
    // off the critical path, and guarded against both sync and async
    // failures; if scriptLoad is unavailable or fails, we just stay
    // on the slow-but-correct EVAL path a little longer.
    if (lockReleaseScriptSha === undefined) {
      try {
        Promise.resolve(client.scriptLoad(LOCK_RELEASE_SCRIPT))
          .then((sha) => {
            lockReleaseScriptSha = sha
          })
          .catch((err) => {
            logger.debug('SCRIPT LOAD failed; staying on EVAL path', errorLogPayload(err))
          })
      } catch (err) {
        logger.debug('SCRIPT LOAD threw synchronously; staying on EVAL path', errorLogPayload(err))
      }
    }
    return result
  }

  async function releaseLock(key: string): Promise<void> {
    try {
      const result = await evalLockRelease(key)

      if (result === 1) {
        return
      }
      throw new LockNotReleasedError(key)
    } catch (error) {
      if (error instanceof LockNotReleasedError) {
        throw error
      }
      logger.error('Error releasing lock', { key, ...errorLogPayload(error) })
      throw error
    }
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

  async function remove(key: string): Promise<void> {
    try {
      await client.del(key)
    } catch (err) {
      logger.error('Error removing key', { key, ...errorLogPayload(err) })
      throw err
    }
  }

  async function keys(pattern: string = '*'): Promise<string[]> {
    try {
      const allKeys: string[] = []
      let cursor = '0'

      do {
        const reply = await client.scan(cursor, {
          MATCH: pattern,
          COUNT: 100
        })
        cursor = reply.cursor
        allKeys.push(...reply.keys)
      } while (cursor !== '0')

      return allKeys
    } catch (err) {
      logger.error('Error scanning keys', { pattern, ...errorLogPayload(err) })
      throw err
    }
  }

  async function setInHash<T>(key: string, field: string, value: T, ttlInSecondsForHash?: number): Promise<void> {
    // Symmetric with `set()`: `JSON.stringify(undefined)` is the value
    // `undefined`, which node-redis would then send as an empty
    // argument. Reject it synchronously so memory-cache and Redis
    // agree on the contract.
    if (value === undefined) {
      throw new Error(`Cannot setInHash an undefined value under key "${key}", field "${field}".`)
    }
    try {
      // client.multi() is synchronous in node-redis v5 and returns a builder;
      // the previous `await client.multi()` was a no-op.
      const multi = client.multi()
      multi.hSet(key, field, JSON.stringify(value))
      if (ttlInSecondsForHash && ttlInSecondsForHash > 0) {
        multi.expire(key, ttlInSecondsForHash)
      }
      // exec() returns one reply per command. When the transaction is
      // queued with errors (e.g. wrong type, OOM reply), node-redis
      // resolves with per-command Error instances instead of throwing.
      // Inspect each so a partially-failed transaction isn't reported
      // to the caller as a clean write.
      const replies = await multi.exec()
      const failed = replies?.find((reply) => reply instanceof Error) as Error | undefined
      if (failed) {
        throw failed
      }
    } catch (err) {
      logger.error('Error setting hash field', { key, field, ...errorLogPayload(err) })
      throw err
    }
  }

  async function getFromHash<T>(key: string, field: string): Promise<T | null> {
    const value = await client.hGet(key, field)
    if (value === null || value === undefined) {
      return null
    }
    return JSON.parse(value) as T
  }

  async function removeFromHash(key: string, field: string): Promise<void> {
    await client.hDel(key, field)
  }

  async function getAllHashFields<T>(key: string): Promise<Record<string, T>> {
    const hashFields = await client.hGetAll(key)
    const result: Record<string, T> = {}
    for (const [field, value] of Object.entries(hashFields)) {
      try {
        result[field] = JSON.parse(value) as T
      } catch (err) {
        // Surface the offending field so the caller can correlate the
        // corruption to a specific entry, rather than losing the rest
        // of the hash to a single malformed value.
        logger.error('Failed to parse hash field', { key, field, ...errorLogPayload(err) })
        throw err
      }
    }
    return result
  }

  return {
    [START_COMPONENT]: start,
    [STOP_COMPONENT]: stop,
    get,
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
