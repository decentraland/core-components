import { IFetchComponent, RequestOptions } from '@dcl/core-commons'
import { FetcherOptions } from './types'

const NON_RETRYABLE_STATUS_CODES = [400, 401, 403, 404]
const IDEMPOTENT_HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']

async function fetchWithRetriesAndTimeout(url: string | URL | Request, options: RequestOptions): Promise<Response> {
  const { timeout, abortController, signal: timeoutSignal, retryDelay } = options
  let attempts = options.attempts!
  let timer: NodeJS.Timeout | null = null
  let response: Response | undefined = undefined

  do {
    try {
      if (timeout) {
        timer = setTimeout(() => {
          abortController!.abort()
        }, timeout)
      }

      const fetchPromise = fetch(url, {
        ...options,
        signal: timeoutSignal
      })

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

      if (timer) clearTimeout(timer)
    } finally {
      if (!!response && (response.ok || NON_RETRYABLE_STATUS_CODES.includes(response.status) || attempts === 0)) break
      else await new Promise((resolve) => setTimeout(resolve, retryDelay))
    }
  } while ((!response || !response.ok) && attempts > 0)

  return response as Response
}

/**
 * @public
 * Creates a fetch component backed by the default Node `fetch` API.
 * @param defaultOptions - default headers and request options injected on every call performed by this component
 */
export function createFetchComponent(defaultOptions?: FetcherOptions): IFetchComponent {
  async function fetch(url: string | URL | Request, options?: RequestOptions): Promise<Response> {
    // Parse options
    const optionsWithDefault = { ...defaultOptions?.defaultFetcherOptions, ...options }
    const { timeout, method = 'GET', retryDelay = 0, abortController, ...fetchOptions } = optionsWithDefault
    let attempts = fetchOptions.attempts || 1
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

    if (signal.aborted) {
      throw new Error('Request aborted (timed out)')
    }

    return response
  }

  return { fetch }
}
