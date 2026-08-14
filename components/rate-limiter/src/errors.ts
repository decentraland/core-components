/**
 * Thrown at construction (or when a middleware is built) rather than per request, so a
 * misconfiguration fails at boot instead of silently allowing or rejecting everything.
 * @public
 */
export class InvalidRateLimitConfigurationError extends Error {
  constructor(
    public setting: string,
    public value: unknown
  ) {
    super(`The rate limit setting "${setting}" is invalid. Received: ${String(value)}`)
  }
}

/**
 * Thrown when the injected cache predates the atomic `increment` primitive. Surfaced at
 * construction because the alternative — failing per request, deep inside the fail-open path —
 * is indistinguishable from a cache outage, i.e. a silently disabled limiter.
 * @public
 */
export class CacheIncrementUnsupportedError extends Error {
  constructor() {
    super(
      'The provided cache component does not implement `increment`. Upgrade @dcl/memory-cache-component / @dcl/redis-component to a version that supports it.'
    )
  }
}
