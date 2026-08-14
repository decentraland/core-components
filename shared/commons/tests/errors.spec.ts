import { LockNotAcquiredError, LockNotReleasedError } from '../src/errors'

describe('when a lock cannot be acquired', () => {
  let error: LockNotAcquiredError

  beforeEach(() => {
    error = new LockNotAcquiredError('my-key')
  })

  it('should be an Error, so it can be thrown and caught normally', () => {
    expect(error).toBeInstanceOf(Error)
  })

  it('should be distinguishable from the release error, which callers branch on', () => {
    expect(error).toBeInstanceOf(LockNotAcquiredError)
    expect(error).not.toBeInstanceOf(LockNotReleasedError)
  })

  it('should name the key in the message', () => {
    expect(error.message).toBe('Lock not acquired for key "my-key"')
  })
})

describe('when a lock cannot be released', () => {
  let error: LockNotReleasedError

  beforeEach(() => {
    error = new LockNotReleasedError('my-key')
  })

  it('should be an Error', () => {
    expect(error).toBeInstanceOf(Error)
  })

  it('should be distinguishable from the acquire error', () => {
    expect(error).toBeInstanceOf(LockNotReleasedError)
    expect(error).not.toBeInstanceOf(LockNotAcquiredError)
  })

  it('should name the key in the message', () => {
    expect(error.message).toBe('Lock not released for key "my-key"')
  })
})
