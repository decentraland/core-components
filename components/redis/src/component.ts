import { ILoggerComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { createClient, RedisClientType } from 'redis'
import { ICacheStorageComponent } from '@dcl/core-commons'

export async function createRedisComponent(
  hostUrl: string,
  components: { logs: ILoggerComponent }
): Promise<ICacheStorageComponent> {
  const { logs } = components
  const logger = logs.getLogger('redis-component')
  
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

  return {
    [START_COMPONENT]: start,
    [STOP_COMPONENT]: stop,
    get,
    set,
    remove,
    keys
  }
}
