import { setTimeout } from 'timers/promises'
import { withTimeout } from '../src/utils'

describe('when running a callback with withTimeout', () => {
  describe('and the callback resolves before the timeout is reached', () => {
    let suppliedController: AbortController

    beforeEach(async () => {
      await withTimeout(async (abortController) => {
        suppliedController = abortController
      }, 100000)
    })

    it('should supply an AbortController to the callback', () => {
      expect(suppliedController).toBeInstanceOf(AbortController)
    })
  })

  describe('and the timeout is reached before the callback resolves', () => {
    let suppliedController: AbortController
    const timeout = 100

    beforeEach(async () => {
      try {
        await withTimeout(async (abortController) => {
          suppliedController = abortController
          return setTimeout(timeout + 300, 'late', { signal: abortController.signal })
        }, timeout)
      } catch (error) {
        // the callback is aborted once the timeout elapses, rejecting the inner setTimeout
      }
    })

    it('should abort the controller supplied to the callback', () => {
      expect(suppliedController.signal.aborted).toBe(true)
    })
  })
})
