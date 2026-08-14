import { ILoggerComponent, START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { createLoggerMockedComponent, ICacheStorageComponent, sleep } from '@dcl/core-commons'
import { createRedisComponent } from '../src/component'

// The rest of the suite mocks `client.eval`, so the Lua script is never executed there. Mutating it —
// `PEXPIRE` to `EXPIRE`, swapping the return order, dropping the `ttl < 0` guard — leaves every
// mocked assertion green while breaking production, so the script needs at least one run against a
// real server. CI provides one; locally, `docker run --rm -p 6379:6379 redis:7` and
// `REDIS_URL=redis://localhost:6379 pnpm test` covers it.
const REDIS_URL = process.env.REDIS_URL
const describeWithRedis = REDIS_URL ? describe : describe.skip

describeWithRedis('when incrementing against a real Redis', () => {
  let logs: ILoggerComponent
  let component: ICacheStorageComponent
  let key: string

  beforeEach(async () => {
    logs = createLoggerMockedComponent({ error: jest.fn(), debug: jest.fn() })
    component = await createRedisComponent(REDIS_URL as string, { logs })
    await component[START_COMPONENT]!({} as any)
    // A fresh key per test: the counter is the state under test, and a leftover would mask a bug.
    key = `increment-integration:${process.pid}:${expect.getState().currentTestName}`
    await component.remove(key)
  })

  afterEach(async () => {
    await component.remove(key)
    await component[STOP_COMPONENT]!()
  })

  describe('and the counter does not exist yet', () => {
    let result: { value: number; ttlRemainingInMilliseconds?: number }

    beforeEach(async () => {
      result = await component.increment(key, { ttlInSeconds: 60 })
    })

    it('should create it at the increment amount', () => {
      expect(result.value).toBe(1)
    })

    it('should report the TTL in milliseconds, proving PEXPIRE rather than EXPIRE was used', () => {
      // `EXPIRE` with the same argument would yield ~60_000_000 ms, a 1000x longer window.
      expect(result.ttlRemainingInMilliseconds).toBeGreaterThan(58_000)
      expect(result.ttlRemainingInMilliseconds).toBeLessThanOrEqual(60_000)
    })
  })

  describe('and the counter is incremented again after real time has passed', () => {
    let first: { value: number; ttlRemainingInMilliseconds?: number }
    let second: { value: number; ttlRemainingInMilliseconds?: number }

    beforeEach(async () => {
      first = await component.increment(key, { ttlInSeconds: 60 })
      await sleep(1100)
      second = await component.increment(key, { ttlInSeconds: 60 })
    })

    it('should accumulate the count', () => {
      expect(second.value).toBe(2)
    })

    it('should leave the deadline where it was, so the window cannot slide', () => {
      // The guard that makes this true is `if ttl < 0` in the script. Without it the TTL would be
      // re-applied on every hit and the window would never end.
      expect(second.ttlRemainingInMilliseconds!).toBeLessThan(first.ttlRemainingInMilliseconds! - 900)
    })
  })

  describe('and no TTL is requested', () => {
    let result: { value: number; ttlRemainingInMilliseconds?: number }

    beforeEach(async () => {
      result = await component.increment(key)
    })

    it('should leave the counter without an expiry rather than erroring on the missing argument', () => {
      expect(result).toEqual({ value: 1, ttlRemainingInMilliseconds: undefined })
    })
  })

  describe('and an existing counter has no expiry while a TTL is requested', () => {
    let result: { value: number; ttlRemainingInMilliseconds?: number }

    beforeEach(async () => {
      await component.increment(key)
      result = await component.increment(key, { ttlInSeconds: 30 })
    })

    it('should install the requested expiry, repairing an immortal counter', () => {
      expect(result.value).toBe(2)
      expect(result.ttlRemainingInMilliseconds).toBeGreaterThan(28_000)
    })
  })

  describe('and the window elapses', () => {
    let result: { value: number }

    beforeEach(async () => {
      await component.increment(key, { ttlInSeconds: 1 })
      await sleep(1200)
      result = await component.increment(key, { ttlInSeconds: 1 })
    })

    it('should restart the count', () => {
      expect(result.value).toBe(1)
    })
  })

  describe('and many increments race', () => {
    let values: number[]

    beforeEach(async () => {
      const results = await Promise.all(
        Array.from({ length: 200 }, () => component.increment(key, { ttlInSeconds: 60 }))
      )
      values = results.map(result => result.value)
    })

    it('should lose no updates', () => {
      expect(new Set(values).size).toBe(200)
      expect(Math.max(...values)).toBe(200)
    })
  })

  describe('and a custom amount is given', () => {
    let result: { value: number }

    beforeEach(async () => {
      await component.increment(key, { amount: 5, ttlInSeconds: 60 })
      result = await component.increment(key, { amount: -2, ttlInSeconds: 60 })
    })

    it('should add it, including a negative amount', () => {
      expect(result.value).toBe(3)
    })
  })

  describe('and the stored value is not an integer counter', () => {
    beforeEach(async () => {
      await component.set(key, { not: 'a counter' })
    })

    it('should reject the increment rather than produce a nonsense count', async () => {
      await expect(component.increment(key)).rejects.toThrow()
    })
  })

  describe('and a counter written by increment is read back', () => {
    let value: number | null

    beforeEach(async () => {
      await component.increment(key, { ttlInSeconds: 60 })
      value = await component.get<number>(key)
    })

    it('should be readable as a number through get', () => {
      expect(value).toBe(1)
    })
  })
})
