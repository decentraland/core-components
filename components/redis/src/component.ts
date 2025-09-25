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

export async function createRedisComponent(
  hostUrl: string,
  components: { logs: ILoggerComponent }
): Promise<ICacheStorageComponent> {
  const { logs } = components
  const logger = logs.getLogger('redis-component')
  const randomValue = randomUUID()

  // Initialize client immediately for testing
  const client: RedisClientType = createClient({ url: hostUrl })

  client.on('error', (err: Error) => {
    logger.error('Redis client error', { error: err.message })
  })

  async function start() {
    try {
      logger.debug('Connecting to Redis', { hostUrl })
      await client.connect()
      logger.debug('Successfully connected to Redis')
    } catch (err: any) {
      logger.error('Error connecting to Redis', err)
      throw err
    }
  }

  async function stop() {
    try {
      logger.debug('Disconnecting from Redis')
      if (client) {
        await client.quit()
      }
      logger.debug('Successfully disconnected from Redis')
    } catch (err: any) {
      logger.error('Error disconnecting from Redis', err)
    }
  }

  async function get<T>(key: string): Promise<T | null> {
    try {
      const serializedValue = await client.get(key.toLowerCase())
      if (serializedValue) {
        return JSON.parse(serializedValue) as T
      }
      return null
    } catch (err: any) {
      logger.error(`Error getting key "${key}"`, err)
      throw err
    }
  }

  async function set<T>(key: string, value: T, ttlInSeconds?: number): Promise<void> {
    try {
      const serializedValue = JSON.stringify(value)
      await client.set(key.toLowerCase(), serializedValue, { EX: ttlInSeconds as number | undefined })
      logger.debug(`Successfully set key "${key}"`)
    } catch (err: any) {
      logger.error(`Error setting key "${key}"`, err)
      throw err
    }
  }

  async function acquireLock(
    key: string,
    options?: { ttlInMilliseconds?: number; retryDelayInMilliseconds?: number; retries?: number }
  ): Promise<void> {
    const ttl = options?.ttlInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS
    const retryDelay = options?.retryDelayInMilliseconds ?? DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS
    const retries = options?.retries ?? DEFAULT_ACQUIRE_LOCK_RETRIES

    for (let i = 0; i < retries; i++) {
      const lock = await client.set(key.toLowerCase(), randomValue, { NX: true, EX: ttl })
      if (lock) {
        logger.debug(`Successfully acquired lock for key "${key}"`)
        return
      } else {
        logger.debug(`Could not acquire lock for key "${key}"`)
        if (i < retries - 1) {
          await sleep(retryDelay)
        }
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
          keys: [key.toLowerCase()],
          arguments: [randomValue]
        }
      )) as number

      if (result === 1) {
        return
      } else {
        throw new LockNotReleasedError(key)
      }
    } catch (error) {
      if (error instanceof LockNotReleasedError) {
        throw error
      }
      logger.error(
        `Error releasing lock for key "${key}": ${isErrorWithMessage(error) ? error.message : 'Unknown error'}`
      )
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
      await client.del(key.toLowerCase())
      logger.debug(`Successfully removed key "${key}"`)
    } catch (err: any) {
      logger.error(`Error removing key "${key}"`, err)
      throw err
    }
  }

  async function keys(pattern: string = '*'): Promise<string[]> {
    try {
      const allKeys: string[] = []
      let cursor = 0

      do {
        const reply = await client.scan(cursor, {
          MATCH: pattern,
          COUNT: 100 // Process in batches of 100
        })
        cursor = reply.cursor
        allKeys.push(...reply.keys)
      } while (cursor !== 0)

      return allKeys
    } catch (err: any) {
      logger.error('Error scanning keys', err)
      throw err
    }
  }

  async function setInHash<T>(key: string, field: string, value: T, ttlInSecondsForHash?: number): Promise<void> {
    const multi = await client.multi()
    multi.hSet(key, field, JSON.stringify(value))
    if (ttlInSecondsForHash) {
      multi.expire(key, ttlInSecondsForHash)
    }
    await multi.exec()
  }

  async function getFromHash<T>(key: string, field: string): Promise<T | null> {
    const value = await client.hGet(key, field)
    return value ? JSON.parse(value) : null
  }

  async function removeFromHash(key: string, field: string): Promise<void> {
    await client.hDel(key, field)
  }

  async function getAllHashFields<T>(key: string): Promise<Record<string, T>> {
    const hashFields = await client.hGetAll(key)
    return Object.entries(hashFields).reduce((acc: Record<string, T>, [field, value]) => {
      acc[field] = JSON.parse(value)
      return acc
    }, {} as Record<string, T>)
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
