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

export async function createRedisComponent(
  hostUrl: string,
  components: { logs: ILoggerComponent }
): Promise<ICacheStorageComponent> {
  const { logs } = components
  const logger = logs.getLogger('redis-component')
  const randomValue = randomUUID()

  const client: RedisClientType = createClient({ url: hostUrl })

  client.on('error', (err: Error) => {
    logger.error('Redis client error', { error: err.message })
  })

  async function start() {
    // Idempotent: if connect() has already run (or is running), there's
    // nothing to do. Calling client.connect() twice on node-redis v5
    // throws "Socket already opened".
    if (client.isOpen) {
      return
    }
    try {
      logger.debug('Connecting to Redis', { hostUrl })
      await client.connect()
      logger.debug('Successfully connected to Redis')
    } catch (err) {
      logger.error('Error connecting to Redis', { error: errorMessageOf(err) })
      throw err
    }
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
      logger.error('Error disconnecting from Redis', { error: errorMessageOf(err) })
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
      logger.error('Error getting key', { key, error: errorMessageOf(err) })
      throw err
    }
  }

  async function set<T>(key: string, value: T, ttlInSeconds?: number): Promise<void> {
    try {
      const serializedValue = JSON.stringify(value)
      // Only include EX when a positive TTL was provided. Passing
      // `{ EX: undefined }` is interpreted inconsistently across
      // node-redis versions.
      const options = ttlInSeconds && ttlInSeconds > 0 ? { EX: ttlInSeconds } : undefined
      await client.set(key, serializedValue, options)
    } catch (err) {
      logger.error('Error setting key', { key, error: errorMessageOf(err) })
      throw err
    }
  }

  async function acquireLock(
    key: string,
    options?: { ttlInMilliseconds?: number; retryDelayInMilliseconds?: number; retries?: number }
  ): Promise<void> {
    const ttlInMilliseconds = options?.ttlInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS
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
        await sleep(retryDelay)
      }
    }

    throw new LockNotAcquiredError(key)
  }

  async function releaseLock(key: string): Promise<void> {
    try {
      const result = (await client.eval(
        `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end`,
        {
          keys: [key],
          arguments: [randomValue]
        }
      )) as number

      if (result === 1) {
        return
      }
      throw new LockNotReleasedError(key)
    } catch (error) {
      if (error instanceof LockNotReleasedError) {
        throw error
      }
      logger.error('Error releasing lock', { key, error: errorMessageOf(error) })
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
      logger.error('Error removing key', { key, error: errorMessageOf(err) })
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
      logger.error('Error scanning keys', { pattern, error: errorMessageOf(err) })
      throw err
    }
  }

  async function setInHash<T>(key: string, field: string, value: T, ttlInSecondsForHash?: number): Promise<void> {
    // client.multi() is synchronous in node-redis v5 and returns a builder;
    // the previous `await client.multi()` was a no-op.
    const multi = client.multi()
    multi.hSet(key, field, JSON.stringify(value))
    if (ttlInSecondsForHash && ttlInSecondsForHash > 0) {
      multi.expire(key, ttlInSecondsForHash)
    }
    await multi.exec()
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
        logger.error('Failed to parse hash field', { key, field, error: errorMessageOf(err) })
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
