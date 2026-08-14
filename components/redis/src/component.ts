import { ILoggerComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { createClient, RedisClientType } from 'redis'
import { createHash, randomUUID } from 'crypto'
import {
  ICacheStorageComponent,
  IncrementOptions,
  IncrementResult,
  assertCounterWithinSafeRange,
  assertValidIncrementOptions,
  fromSecondsToMilliseconds,
  isErrorWithMessage,
  sleep,
  DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_RETRIES,
  LockNotAcquiredError,
  LockNotReleasedError
} from '@dcl/core-commons'

// Increments and reads the counter's expiry in a single round trip. `INCRBY` creates the counter at
// 0 when absent, so the value is always correct; `PTTL` then reports whether it has an expiry at all
// (a negative reply means it does not). Setting the expiry only when there isn't one already is what
// keeps a fixed window from sliding on every hit — and it also repairs a counter that was created
// without a TTL, which the common `if current == 1` form leaves immortal.
export const INCREMENT_SCRIPT = `
local value = redis.call('INCRBY', KEYS[1], ARGV[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 and ARGV[2] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  ttl = tonumber(ARGV[2])
end
return { value, ttl }`

// Compare-and-delete: only the holder of the lock may release it.
export const RELEASE_LOCK_SCRIPT = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end`

// Computed once at module load rather than per call.
const INCREMENT_SCRIPT_SHA = scriptSha(INCREMENT_SCRIPT)
const RELEASE_LOCK_SCRIPT_SHA = scriptSha(RELEASE_LOCK_SCRIPT)

// A short, stable digest standing in for a key in logs, so an operator can correlate repeated
// failures without the key's contents (often an IP or a wallet address) being written down.
// NOTE: the other methods in this component still log raw keys — a pre-existing pattern worth
// sweeping separately, since their keys carry identifiers too.
function fingerprintKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12)
}

/**
 * A Redis URL with any credentials removed, safe to log. `redis://user:secret@host:6379` carries the
 * password in the userinfo, so logging the raw URL would write it to disk on every connect.
 */
function redactUrl(hostUrl: string): string {
  try {
    const url = new URL(hostUrl)
    if (url.password) url.password = '***'
    if (url.username) url.username = '***'
    return url.toString()
  } catch {
    // Not parseable as a URL, so nothing can be reliably separated out — say nothing rather than
    // risk emitting a credential.
    return '<unparseable redis url>'
  }
}

// Redis addresses a cached script by the SHA-1 of its body, so the digest can be computed locally —
// no `SCRIPT LOAD` round trip is needed to learn it.
function scriptSha(script: string): string {
  return createHash('sha1').update(script).digest('hex')
}

// Redis replies `NOSCRIPT` when the script is not in its cache. That happens on the very first call,
// and again after a restart, a failover to a replica, or a `SCRIPT FLUSH`, so it has to be handled
// every time rather than just once at startup.
function isNoScriptError(error: unknown): boolean {
  return isErrorWithMessage(error) && error.message.includes('NOSCRIPT')
}

export async function createRedisComponent(
  hostUrl: string,
  components: { logs: ILoggerComponent }
): Promise<ICacheStorageComponent> {
  const { logs } = components
  const logger = logs.getLogger('redis-component')
  const randomValue = randomUUID()

  // Initialize client immediately for testing
  const client: RedisClientType = createClient({ url: hostUrl })

  // Whether the component has ever completed a connection. Startup is the one phase where a failure
  // has no caller to report it: `connect()` does not reject on an unreachable server, it retries, so
  // `start()` stays pending and its own catch never runs. Without a line here a service booting
  // against a dead Redis simply hangs with nothing above debug to say why.
  let hasConnected = false
  let warnedAboutStartupFailure = false

  client.on('error', (err: Error) => {
    // Only before the first success, and only once: node-redis emits an error per retry attempt, so
    // this must not scale with the retry loop. Everything after it, and every blip once the component
    // has connected, stays at debug — those failures reach a caller through a throw.
    if (!hasConnected && !warnedAboutStartupFailure) {
      warnedAboutStartupFailure = true
      logger.warn(
        'Redis client error before the first successful connection. If this is startup, the client is retrying and the service will not become ready until Redis is reachable.',
        { error: err.message, hostUrl: redactUrl(hostUrl) }
      )
      return
    }
    logger.debug('Redis client error', { error: err.message })
  })

  /**
   * Runs a Lua script by digest, falling back to sending the body when Redis does not have it cached.
   *
   * `EVAL` re-uploads the whole script on every call. For a per-request workload — a rate limiter
   * counting each request — that is the script body on the wire every time, so `EVALSHA` sends a
   * 40-byte digest instead. The fallback keeps it correct rather than merely faster: the digest is
   * unknown to Redis on the first call and after any restart, failover or `SCRIPT FLUSH`, and `EVAL`
   * both answers that call and re-caches the script for the next one.
   */
  async function evalScript<T>(script: string, sha: string, keys: string[], args: string[]): Promise<T> {
    try {
      return (await client.evalSha(sha, { keys, arguments: args })) as T
    } catch (error) {
      if (!isNoScriptError(error)) throw error
      logger.debug('Script not cached by Redis; sending the body and letting it cache', { sha })
      return (await client.eval(script, { keys, arguments: args })) as T
    }
  }

  async function start() {
    try {
      logger.debug('Connecting to Redis', { hostUrl: redactUrl(hostUrl) })
      await client.connect()
      hasConnected = true
      logger.debug('Successfully connected to Redis')
    } catch (err: any) {
      // Error level here, unlike the operation methods: a service that cannot reach its cache at boot
      // is not going to serve, and this is a single bounded event rather than one per request. It is
      // still rethrown, so the caller decides whether to abort.
      logger.error('Error connecting to Redis', err)
      throw err
    }
  }

  async function stop() {
    try {
      logger.debug('Disconnecting from Redis')
      if (client) {
        await client.close()
      }
      logger.debug('Successfully disconnected from Redis')
    } catch (err: any) {
      logger.debug('Error disconnecting from Redis', err)
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
      logger.debug(`Error getting key "${key}"`, err)
      throw err
    }
  }

  async function set<T>(key: string, value: T, ttlInSeconds?: number): Promise<void> {
    try {
      const serializedValue = JSON.stringify(value)
      await client.set(key.toLowerCase(), serializedValue, { EX: ttlInSeconds as number | undefined })
    } catch (err: any) {
      logger.debug(`Error setting key "${key}"`, err)
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
      const result = await evalScript<number>(
        RELEASE_LOCK_SCRIPT,
        RELEASE_LOCK_SCRIPT_SHA,
        [key.toLowerCase()],
        [randomValue]
      )

      if (result === 1) {
        return
      } else {
        throw new LockNotReleasedError(key)
      }
    } catch (error) {
      if (error instanceof LockNotReleasedError) {
        throw error
      }
      logger.debug(
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
    } catch (err: any) {
      logger.debug(`Error removing key "${key}"`, err)
      throw err
    }
  }

  async function exists(key: string): Promise<boolean> {
    try {
      // node-redis returns the count of keys that exist among the args; for a
      // single key we get 0 or 1. Coerce to boolean for the interface.
      const count = await client.exists(key.toLowerCase())
      return count > 0
    } catch (err: any) {
      logger.debug(`Error checking existence of key "${key}"`, err)
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
          COUNT: 100 // Process in batches of 100
        })
        cursor = reply.cursor
        allKeys.push(...reply.keys)
      } while (cursor !== '0')

      return allKeys
    } catch (err: any) {
      logger.debug('Error scanning keys', err)
      throw err
    }
  }

  async function increment(key: string, options?: IncrementOptions): Promise<IncrementResult> {
    const { amount, ttlInSeconds } = assertValidIncrementOptions(options)

    try {
      // `EvalOptions.arguments` is typed as `RedisArgument` (string | Buffer): a raw number throws
      // before the call ever reaches the server, so both args are stringified.
      const args = [String(amount)]
      if (ttlInSeconds !== undefined) {
        // `PEXPIRE` rather than `EXPIRE` so sub-second windows and fractional TTLs survive.
        args.push(String(Math.ceil(fromSecondsToMilliseconds(ttlInSeconds))))
      }

      const [value, ttlRemaining] = await evalScript<[number, number]>(
        INCREMENT_SCRIPT,
        INCREMENT_SCRIPT_SHA,
        [key.toLowerCase()],
        args
      )

      // Redis counts in int64, which reaches further than JavaScript represents exactly, so a counter
      // past that range would arrive here already rounded.
      assertCounterWithinSafeRange(value)

      return {
        value,
        ttlRemainingInMilliseconds: ttlRemaining < 0 ? undefined : ttlRemaining
      }
    } catch (err: any) {
      // Fingerprint rather than the raw key. Counter keys routinely embed a client IP, a wallet
      // address or another caller-supplied identifier, and an outage logs one line per request — so
      // the raw key would push personal data into logs at volume. The digest is stable, so repeated
      // failures on one key still correlate.
      logger.debug(`Error incrementing key (fingerprint ${fingerprintKey(key)})`, err)
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
    exists,
    keys,
    increment,
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
