import {
  DEFAULT_ACQUIRE_LOCK_RETRIES,
  DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS,
  DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS,
  fromSecondsToMilliseconds,
  sleep
} from '../src/time'

describe('when converting seconds to milliseconds', () => {
  describe.each([
    ['a whole number', 60, 60_000],
    ['zero', 0, 0],
    ['a fraction', 0.5, 500],
    ['a negative number', -1, -1000]
  ])('and the value is %s', (_label, seconds, expected) => {
    it('should scale it by a thousand', () => {
      expect(fromSecondsToMilliseconds(seconds)).toBe(expected)
    })
  })
})

describe('when sleeping', () => {
  let elapsed: number

  beforeEach(async () => {
    // Real time rather than fake timers: the point is that the promise actually defers, and a fake
    // clock would let a broken implementation that resolves immediately pass.
    const startedAt = Date.now()
    await sleep(25)
    elapsed = Date.now() - startedAt
  })

  it('should resolve only after roughly the requested delay', () => {
    expect(elapsed).toBeGreaterThanOrEqual(20)
  })
})

describe('when sleeping for no time at all', () => {
  it('should still resolve rather than hang', async () => {
    await expect(sleep(0)).resolves.toBeUndefined()
  })
})

describe('when reading the lock defaults', () => {
  it('should express the TTL in milliseconds', () => {
    expect(DEFAULT_ACQUIRE_LOCK_TTL_IN_MILLISECONDS).toBe(10_000)
  })

  it('should express the retry delay in milliseconds', () => {
    expect(DEFAULT_ACQUIRE_LOCK_RETRY_DELAY_IN_MILLISECONDS).toBe(200)
  })

  it('should bound the retries', () => {
    expect(DEFAULT_ACQUIRE_LOCK_RETRIES).toBe(10)
  })
})
