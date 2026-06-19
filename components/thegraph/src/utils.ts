import { setTimeout } from 'timers/promises'
import { SubgraphQueryTimeoutError } from './errors'
import { SubgraphProvider } from './types'

export const UNKNOWN_SUBGRAPH_PROVIDER: SubgraphProvider = 'UNKNOWN'

/**
 * Runs `callback`, racing it against a `timeout` (ms). The callback receives an `AbortController`
 * that is aborted when the timeout elapses, so it can cancel its in-flight work.
 *
 * Whichever settles first wins deterministically: if the callback settles first its result (or
 * error) is returned/thrown unchanged; if the timeout elapses first a `SubgraphQueryTimeoutError`
 * is thrown. Racing — rather than translating any post-abort rejection into a timeout — avoids
 * misreporting an unrelated failure that merely coincides with the timeout, and avoids depending
 * on how the injected fetch component surfaces an aborted request.
 */
export async function withTimeout<T>(
  callback: (abortController: AbortController) => Promise<T>,
  timeout: number
): Promise<T> {
  const callbackAbortController = new AbortController()
  const timeoutAbortController = new AbortController()

  const request = callback(callbackAbortController)
  // If the timeout wins the race we abort the request afterwards; swallow that late rejection so it
  // never surfaces as an unhandled rejection.
  request.catch(() => {})

  const timeoutExpired = setTimeout(timeout, 'Timeout', { signal: timeoutAbortController.signal }).then(() => {
    throw new SubgraphQueryTimeoutError(timeout)
  })
  // If the request wins the race we cancel the timer, which rejects this promise with an AbortError.
  timeoutExpired.catch(() => {})

  try {
    return await Promise.race([request, timeoutExpired])
  } finally {
    // Cancel the pending timer and abort the in-flight request, whichever is still running.
    timeoutAbortController.abort()
    callbackAbortController.abort()
  }
}
