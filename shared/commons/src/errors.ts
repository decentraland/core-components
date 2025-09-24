export class LockNotAcquiredError extends Error {
  constructor(key: string) {
    super(`Lock not acquired for key "${key}"`)
  }
}

export class LockNotReleasedError extends Error {
  constructor(key: string) {
    super(`Lock not released for key "${key}"`)
  }
}
