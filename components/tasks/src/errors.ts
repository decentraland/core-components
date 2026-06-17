/** Thrown by `createTaskQueue().scheduleWithRetries` when called with a non-positive retry count. */
export class InvalidRetriesError extends Error {
  constructor() {
    super('At least one retry is required')
    this.name = 'InvalidRetriesError'
  }
}

/** Thrown by `createExponentialBackoffRetry` when `maxInterval` is negative. */
export class InvalidMaxIntervalError extends Error {
  constructor() {
    super('options.maxInterval must be >= 0')
    this.name = 'InvalidMaxIntervalError'
  }
}
