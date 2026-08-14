// Shared utility functions for core components

import type { IncrementOptions } from './types'

export function isErrorWithMessage(error: unknown): error is Error {
  return error !== undefined && error !== null && typeof error === 'object' && 'message' in error
}

/**
 * Validates and normalizes {@link IncrementOptions}, applying the default amount of `1`. Shared by
 * every `ICacheStorageComponent` implementation so they reject the same inputs with the same message.
 *
 * @throws {TypeError} When `amount` is not a safe integer or `ttlInSeconds` is not greater than zero.
 * @public
 */
export function assertValidIncrementOptions(options?: IncrementOptions): {
  amount: number
  ttlInSeconds: number | undefined
} {
  const amount = options?.amount ?? 1
  const ttlInSeconds = options?.ttlInSeconds

  if (!Number.isSafeInteger(amount)) {
    throw new TypeError(`increment: "amount" must be a safe integer, got ${options?.amount}`)
  }
  // A non-positive TTL is a footgun rather than a no-op: Redis `PEXPIRE key 0` deletes the key
  // outright, while lru-cache reads a per-call `ttl: 0` as "no expiry" — opposite behaviours from
  // the same input, and the Redis one silently disables any limiter built on this. Reject it in both.
  if (ttlInSeconds !== undefined && (!Number.isFinite(ttlInSeconds) || ttlInSeconds <= 0)) {
    throw new TypeError(`increment: "ttlInSeconds" must be a finite number greater than zero, got ${ttlInSeconds}`)
  }

  return { amount, ttlInSeconds }
}
