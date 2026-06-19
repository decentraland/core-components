import { setTimeout } from 'timers/promises'
import { SubgraphQueryTimeoutError } from '../src/errors'
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
    let thrownError: unknown
    const timeout = 100

    beforeEach(async () => {
      try {
        await withTimeout(async (abortController) => {
          suppliedController = abortController
          return setTimeout(timeout + 300, 'late', { signal: abortController.signal })
        }, timeout)
      } catch (error) {
        thrownError = error
      }
    })

    it('should abort the controller supplied to the callback', () => {
      expect(suppliedController.signal.aborted).toBe(true)
    })

    it('should throw a SubgraphQueryTimeoutError', () => {
      expect(thrownError).toBeInstanceOf(SubgraphQueryTimeoutError)
    })
  })

  describe('and the callback rejects with its own error before the timeout is reached', () => {
    let thrownError: unknown
    let callbackError: Error

    beforeEach(async () => {
      callbackError = new Error('Network error')
      try {
        await withTimeout(async () => {
          throw callbackError
        }, 100000)
      } catch (error) {
        thrownError = error
      }
    })

    it("should rethrow the callback's original error rather than a SubgraphQueryTimeoutError", () => {
      expect(thrownError).toBe(callbackError)
    })
  })
})
