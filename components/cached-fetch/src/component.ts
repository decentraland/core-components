import { LRUCache } from 'lru-cache'
import { Response } from 'node-fetch'
import { createFetchComponent } from '@well-known-components/fetch-component'
import type { IFetchComponent } from '@well-known-components/interfaces'
import type { CachedFetchComponentOptions, CachedResponseData, Request, RequestInit } from './types'
import { getMethod, getUrlString, hashBody, extractHeadersForCacheKey } from './utils'

const DEFAULT_MAX = 1000
const DEFAULT_TTL = 1000 * 60 * 5 // 5 minutes
const DEFAULT_CACHEABLE_METHODS = ['GET']
const DEFAULT_CACHEABLE_ERROR_STATUS_CODES: number[] = []
const DEFAULT_CACHE_KEY_HEADERS: string[] = []

/**
 * Creates a cached fetch component
 *
 * This component wraps an existing fetch component and adds LRU caching capabilities.
 * It caches successful responses based on URL and HTTP method, reducing redundant network requests.
 * Error responses (non-ok status) are returned directly without caching, unless their status code
 * is included in the cacheableErrorStatusCodes option.
 *
 * Orchestration flow:
 * 1. Receives a fetch request with URL and options
 * 2. Checks if the request method is cacheable
 * 3. If cacheable, attempts to retrieve from cache
 * 4. If cache miss, performs the fetch
 * 5. If response is ok or status is in cacheableErrorStatusCodes, caches it for future use
 * 6. Returns the response (from cache or network)
 *
 * @remarks
 * This component uses node-fetch internally. Cached responses are always returned as node-fetch
 * Response objects, regardless of what fetch implementation the underlying fetchComponent uses.
 * This ensures full compatibility with @well-known-components/fetch-component.
 *
 * @param fetchComponent - The fetch component to wrap (defaults to @well-known-components/fetch-component)
 * @param options - Configuration options for cache behavior
 * @returns IFetchComponent implementation with caching
 */
export async function createCachedFetchComponent(
  fetchComponent: IFetchComponent = createFetchComponent(),
  options?: CachedFetchComponentOptions
): Promise<IFetchComponent> {
  // Extract custom options
  const { cacheableMethods, cacheableErrorStatusCodes, cacheKeyHeaders, ...lruOptions } = options ?? {}

  const resolvedCacheableMethods = cacheableMethods ?? DEFAULT_CACHEABLE_METHODS
  const resolvedCacheableErrorStatusCodes = cacheableErrorStatusCodes ?? DEFAULT_CACHEABLE_ERROR_STATUS_CODES
  const resolvedCacheKeyHeaders = cacheKeyHeaders ?? DEFAULT_CACHE_KEY_HEADERS

  // Create LRU cache with defaults and user-provided options
  const cache = new LRUCache<string, CachedResponseData>({
    max: DEFAULT_MAX,
    ttl: DEFAULT_TTL,
    ...lruOptions
  })

  /**
   * Checks if a request method should be cached
   *
   * @param url - The request URL or Request object
   * @param init - Request initialization options
   * @returns True if the method is cacheable
   */
  function isCacheable(url: Request, init?: RequestInit): boolean {
    const method = getMethod(url, init)
    return resolvedCacheableMethods.includes(method)
  }

  /**
   * Converts a Response to cacheable data
   * Uses arrayBuffer() for cross-platform compatibility
   *
   * @param response - The response to convert
   * @returns The cached response data
   */
  async function responseToCachedData(response: Response): Promise<CachedResponseData> {
    const body = new Uint8Array(await response.arrayBuffer());
    const headers: Record<string, string> = {}
    response.headers.forEach((value: string, key: string) => {
      headers[key] = value
    })

    return {
      body,
      status: response.status,
      statusText: response.statusText,
      headers
    }
  }

  /**
   * Converts cached data back to a Response
   *
   * @param cachedData - The cached response data
   * @returns A new Response object
   */
  function cachedDataToResponse(cachedData: CachedResponseData): Response {
    return new Response(Buffer.from(cachedData.body), {
      status: cachedData.status,
      statusText: cachedData.statusText,
      headers: cachedData.headers
    })
  }

  /**
   * Generates a cache key from URL, method, headers, and body
   *
   * @param url - The request URL or Request object
   * @param init - Optional request initialization options
   * @returns A string key for cache lookup
   */
  function getCacheKey(url: Request, init?: RequestInit): string {
    const method = getMethod(url, init)
    const urlString = getUrlString(url)
    const headersKey = extractHeadersForCacheKey(init, resolvedCacheKeyHeaders)
    const bodyHash = hashBody(init?.body)

    let key = `${method}:${urlString}`
    if (headersKey) {
      key += `|h:${headersKey}`
    }
    if (bodyHash) {
      key += `|b:${bodyHash}`
    }
    return key
  }

  return {
    /**
     * Fetches a resource with caching support
     *
     * For cacheable methods (GET by default), this method will:
     * - Return cached response if available and not expired
     * - Perform network request on cache miss
     * - Cache successful responses (ok: true) or responses with status in cacheableErrorStatusCodes
     * - Return other error responses (ok: false) without caching
     *
     * For non-cacheable methods, this method passes through to the underlying fetch.
     *
     * @param url - The URL to fetch
     * @param init - Optional request initialization options
     * @returns Promise resolving to the Response
     */
    async fetch(url: Request, init?: RequestInit): Promise<Response> {
      // Non-cacheable methods bypass the cache
      if (!isCacheable(url, init)) {
        return fetchComponent.fetch(url, init)
      }

      const key = getCacheKey(url, init)

      // Check cache first
      const cachedData = cache.get(key)
      if (cachedData) {
        return cachedDataToResponse(cachedData)
      }

      // Cache miss - fetch from network
      const response = await fetchComponent.fetch(url, init)

      // Cache successful responses or responses with cacheable status codes
      const shouldCache = response.ok || resolvedCacheableErrorStatusCodes.includes(response.status)
      if (shouldCache) {
        const cacheData = await responseToCachedData(response)
        cache.set(key, cacheData)
        return cachedDataToResponse(cacheData)
      }

      // Return other error responses without caching
      return response
    }
  }
}
