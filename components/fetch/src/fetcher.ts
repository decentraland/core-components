import { IFetchComponent, RequestOptions } from '@dcl/core-commons'
import { FetcherOptions } from './types'

const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404])
const IDEMPOTENT_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])

/**
 * Per-call controls split out from the standard `RequestInit` so the latter can be
 * forwarded to the native fetch untouched.
 */
type FetchControl = {
  timeout?: number
  retryDelay: number
  attempts: number
  abortController: AbortController
}

async function fetchWithRetriesAndTimeout(
  url: string | URL | Request,
  fetchInit: RequestInit,
  control: FetchControl
): Promise<Response> {
  const { timeout, retryDelay, abortController } = control
  const timeoutSignal = abortController.signal
  let attempts = control.attempts
  let response: Response | undefined = undefined
  let lastError: unknown = undefined

  do {
    // Reset the per-attempt outcome so a previous attempt's value can't leak into
    // the retry decision below.
    response = undefined
    lastError = undefined
    let timer: NodeJS.Timeout | null = null

    try {
      if (timeout) {
        // Abort the in-flight request once the timeout elapses. The aborted fetch
        // rejects below and is turned into the dedicated timeout error after the
        // loop — no separate timeout promise to race against and clean up.
        timer = setTimeout(() => abortController.abort(), timeout)
      }

      --attempts

      response = await fetch(url, fetchInit)
    } catch (error) {
      // A rejected fetch is either an abort (timeout or external controller) or a
      // network-level failure (DNS, connection refused/reset, socket hang up).
      // Capture it: aborts are surfaced as the timeout error after the loop;
      // network errors are retried like a retryable status for idempotent methods.
      lastError = error
    } finally {
      // Clear the timer on every exit (success, retryable failure or rejection) so
      // a pending timeout can't later abort a controller reused by the caller or by
      // a subsequent retry.
      if (timer) clearTimeout(timer)
    }

    // Stop on a successful or non-retryable response.
    if (response && (response.ok || NON_RETRYABLE_STATUS_CODES.has(response.status))) break
    // Stop when the request was aborted (timeout or external controller): retrying
    // would reuse an already-aborted signal, and the caller turns this into the
    // "Request aborted (timed out)" error after the loop.
    if (timeoutSignal.aborted) break
    // Stop once the retries are exhausted, keeping the latest response/error around.
    if (attempts === 0) break

    // About to discard this attempt's retryable response. An unconsumed undici
    // response body pins its socket and buffers the received bytes in memory until
    // GC, so a retry loop under load (e.g. an upstream returning 5xx) leaks both
    // connections and heap. Cancelling releases the body and connection right away.
    // The final attempt's response is returned to the caller below and is never
    // reached here, so the caller still owns its body.
    if (response) await response.body?.cancel().catch(() => {})

    await new Promise((resolve) => setTimeout(resolve, retryDelay))
  } while (true)

  // An aborted signal (timeout or external controller) takes precedence over any
  // response gathered so far and surfaces the dedicated abort error.
  if (timeoutSignal.aborted) {
    throw new Error('Request aborted (timed out)')
  }

  // No response means every attempt failed at the network level. "Last attempt
  // wins": if an earlier attempt returned a retryable HTTP response (e.g. 503) but
  // the final attempt was a network error, the network error is thrown rather than
  // the earlier response returned.
  if (!response) {
    throw lastError
  }

  return response
}

/**
 * @public
 * Creates a fetch component backed by the default Node `fetch` API.
 * @param defaultOptions - default headers and request options injected on every call performed by this component
 */
export function createFetchComponent(defaultOptions?: FetcherOptions): IFetchComponent {
  // Normalized once at factory build so the common path doesn't re-read it per call.
  const defaultHeaders = defaultOptions?.defaultHeaders as Record<string, string> | undefined

  async function wrappedFetch(url: string | URL | Request, options?: RequestOptions): Promise<Response> {
    const {
      timeout,
      method = 'GET',
      retryDelay = 0,
      abortController,
      attempts: attemptsOption,
      ...fetchOptions
    } = { ...defaultOptions?.defaultFetcherOptions, ...options }

    const controller = abortController || new AbortController()

    // Retries only apply to idempotent methods; everything else gets a single attempt.
    const attempts = IDEMPOTENT_HTTP_METHODS.has(method.toUpperCase()) ? (attemptsOption ?? 1) : 1

    const fetchInit: RequestInit = { ...fetchOptions, method, signal: controller.signal }

    // Merge default headers; call-provided headers win.
    if (defaultHeaders) {
      fetchInit.headers = { ...defaultHeaders, ...((fetchOptions.headers as Record<string, string>) || {}) }
    }

    // fetchWithRetriesAndTimeout resolves to a real Response or throws (on abort,
    // timeout or exhausted network retries), so no further guarding is needed here.
    return fetchWithRetriesAndTimeout(url, fetchInit, { timeout, retryDelay, attempts, abortController: controller })
  }

  return { fetch: wrappedFetch }
}
