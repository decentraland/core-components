// Shared utility functions for core components

import type { IncrementOptions } from './types'

export function isErrorWithMessage(error: unknown): error is Error {
  return error !== undefined && error !== null && typeof error === 'object' && 'message' in error
}

// Quotes strings so a numeric-looking string is distinguishable from the number in an error
// message — `got "3"` rather than the self-contradictory `got 3` for a rejected value.
function describeValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

/**
 * Validates and normalizes {@link IncrementOptions}, applying the default amount of `1`. Shared by
 * every `ICacheStorageComponent` implementation so they reject the same inputs identically.
 *
 * @throws {TypeError} When `amount` is not a safe integer or `ttlInSeconds` is not greater than zero.
 * @public
 */
export function assertValidIncrementOptions(options?: IncrementOptions): {
  amount: number
  ttlInSeconds: number | undefined
} {
  // Only an absent `amount` defaults; `null` is rejected like any other non-integer. `?? 1` would
  // have silently accepted `null` as `1` while `ttlInSeconds: null` threw — an inconsistency that
  // bites when the options come from JSON or config rather than a TS literal.
  const amount = options?.amount === undefined ? 1 : options.amount
  const ttlInSeconds = options?.ttlInSeconds

  if (!Number.isSafeInteger(amount)) {
    throw new TypeError(`increment: "amount" must be a safe integer, got ${describeValue(options?.amount)}`)
  }
  // A non-positive TTL is a footgun rather than a no-op: Redis `PEXPIRE key 0` deletes the key
  // outright, while lru-cache reads a per-call `ttl: 0` as "no expiry" — opposite behaviours from
  // the same input, and the Redis one silently disables any limiter built on this. Reject it in both.
  if (ttlInSeconds !== undefined && (!Number.isFinite(ttlInSeconds) || ttlInSeconds <= 0)) {
    throw new TypeError(
      `increment: "ttlInSeconds" must be a finite number greater than zero, got ${describeValue(ttlInSeconds)}`
    )
  }

  return { amount, ttlInSeconds }
}

/**
 * Asserts that a value already stored under a counter key can actually be incremented. Shared by
 * every `ICacheStorageComponent` implementation so a poisoned key fails the same way on each.
 *
 * `Number.isSafeInteger` rather than `typeof value === 'number'`: `NaN`, `±Infinity` and fractional
 * values are all numbers, and incrementing them yields a counter that silently never crosses a
 * threshold again — `NaN + 1` is `NaN`, so a limiter built on it fails open forever for that key.
 *
 * The key is deliberately absent from the message: it can carry a client IP or a wallet address, and
 * this error reaches logs through callers that catch it. The caller already knows the key it passed.
 *
 * @throws {TypeError} When the stored value is not a safe integer.
 * @public
 */
export function assertIntegerCounter(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`increment: the stored value is not an integer counter, got ${describeValue(value)}`)
  }
}
