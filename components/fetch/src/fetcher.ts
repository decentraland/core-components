import { IFetchComponent, RequestOptions } from '@dcl/core-commons'
import { FetcherOptions } from './types'

const NON_RETRYABLE_STATUS_CODES = [400, 401, 403, 404]
const IDEMPOTENT_HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']

async function fetchWithRetriesAndTimeout(url: string | URL | Request, options: RequestOptions): Promise<Response> {
  // Split the component-specific controls (timeout, retries, abort controller) from
  // the standard `RequestInit` keys that are forwarded as-is to the native fetch.
  const { timeout, abortController, retryDelay, attempts: attemptsOption, ...fetchInit } = options
  const timeoutSignal = fetchInit.signal
  let attempts = attemptsOption!
  let timer: NodeJS.Timeout | null = null
  let response: Response | undefined = undefined
  let lastError: unknown = undefined

  do {
    // Reset the per-attempt outcome so a previous attempt's value can't leak into
    // the retry decision below.
    response = undefined
    lastError = undefined

    try {
      if (timeout) {
        timer = setTimeout(() => {
          abortController!.abort()
        }, timeout)
      }

      const fetchPromise = fetch(url, fetchInit)

      const racePromise = Promise.race([
        fetchPromise,
        new Promise<Response>((resolve) => {
          timeoutSignal!.addEventListener('abort', () => {
            resolve(new Response('timeout', { status: 408, statusText: 'Request Timeout' }))
          })
        })
      ])

      --attempts

      response = await racePromise
    } catch (error) {
      // A rejected fetch means a network-level failure (DNS resolution, connection
      // refused/reset, socket hang up). Capture it so the request can be retried
      // like a retryable status code instead of failing on the first blip.
      lastError = error
    } finally {
      // Clear the timeout timer on every exit (success, retryable failure or a
      // rejected fetch) so a pending timer can't later abort a controller that
      // is reused by the caller or by a subsequent retry.
      if (timer) clearTimeout(timer)
    }

    // Stop on a successful or non-retryable response.
    if (response && (response.ok || NON_RETRYABLE_STATUS_CODES.includes(response.status))) break
    // Stop when the request was aborted (timeout or external controller): retrying
    // would reuse an already-aborted signal, and the caller turns this into the
    // "Request aborted (timed out)" error after the loop.
    if (timeoutSignal?.aborted) break
    // Stop once the retries are exhausted, keeping the latest response/error around.
    if (attempts === 0) break

    await new Promise((resolve) => setTimeout(resolve, retryDelay))
  } while (true)

  // The loop only stops on a usable/non-retryable response, an aborted signal or
  // exhausted retries. Resolve those into a concrete `Response` or a thrown error
  // below so the return type is sound without an `as Response` assertion.

  // An aborted signal (timeout or external controller) takes precedence over any
  // response gathered so far and surfaces the dedicated abort error.
  if (timeoutSignal?.aborted) {
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
  async function wrappedFetch(url: string | URL | Request, options?: RequestOptions): Promise<Response> {
    // Parse options
    const optionsWithDefault = { ...defaultOptions?.defaultFetcherOptions, ...options }
    const {
      timeout,
      method = 'GET',
      retryDelay = 0,
      abortController,
      attempts: attemptsOption,
      ...fetchOptions
    } = optionsWithDefault
    let attempts = attemptsOption ?? 1
    const controller = abortController || new AbortController()
    const { signal } = controller

    // Add default headers
    if (defaultOptions?.defaultHeaders)
      fetchOptions.headers = {
        ...(defaultOptions.defaultHeaders as Record<string, string>),
        ...((fetchOptions.headers as Record<string, string>) || {})
      }

    // Fix attempts in case of POST
    if (!IDEMPOTENT_HTTP_METHODS.includes(method.toUpperCase())) attempts = 1

    // Fetch with retries and timeout
    const response = await fetchWithRetriesAndTimeout(url, {
      ...fetchOptions,
      attempts,
      method,
      timeout,
      retryDelay,
      signal,
      abortController: controller
    })

    // fetchWithRetriesAndTimeout resolves to a real Response or throws (on abort,
    // timeout or exhausted network retries), so no further guarding is needed here.
    return response
  }

  return { fetch: wrappedFetch }
}
