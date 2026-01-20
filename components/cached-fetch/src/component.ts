import { LRUCache } from 'lru-cache'
import { Response } from 'node-fetch'
import { createFetchComponent } from '@well-known-components/fetch-component'
import type { IFetchComponent } from '@well-known-components/interfaces'
import type { CachedFetchComponentOptions, CachedResponseData } from './types'

const DEFAULT_MAX = 1000
const DEFAULT_TTL = 1000 * 60 * 5 // 5 minutes
const DEFAULT_CACHEABLE_METHODS = ['GET']
const DEFAULT_CACHEABLE_STATUS_CODES: number[] = []

/**
 * Generates a cache key from URL and request init options
 *
 * @param url - The request URL
 * @param init - Optional request initialization options
 * @returns A string key for cache lookup
 */
function getCacheKey(url: Parameters<IFetchComponent['fetch']>[0], init?: Parameters<IFetchComponent['fetch']>[1]): string {
  const urlString = typeof url === 'string' ? url : url.toString()
  const method = (init?.method ?? 'GET').toUpperCase()
  return `${method}:${urlString}`
}

/**
 * Creates a cached fetch component
 *
 * This component wraps an existing fetch component and adds LRU caching capabilities.
 * It caches successful responses based on URL and HTTP method, reducing redundant network requests.
 * Error responses (non-ok status) are returned directly without caching, unless their status code
 * is included in the cacheableStatusCodes option.
 *
 * Orchestration flow:
 * 1. Receives a fetch request with URL and options
 * 2. Checks if the request method is cacheable
 * 3. If cacheable, attempts to retrieve from cache
 * 4. If cache miss, performs the fetch
 * 5. If response is ok or status is in cacheableStatusCodes, caches it for future use
 * 6. Returns the response (from cache or network)
 *
 * @param components - Optional components: fetchComponent
 * @param options - Configuration options for cache behavior
 * @returns IFetchComponent implementation with caching
 */
export async function createCachedFetchComponent(
  components?: {
    fetchComponent?: IFetchComponent
  },
  options?: CachedFetchComponentOptions
): Promise<IFetchComponent> {
  const max = options?.max ?? DEFAULT_MAX
  const ttl = options?.ttl ?? DEFAULT_TTL
  const cacheableMethods = options?.cacheableMethods ?? DEFAULT_CACHEABLE_METHODS
  const cacheableStatusCodes = options?.cacheableStatusCodes ?? DEFAULT_CACHEABLE_STATUS_CODES

  const fetchComponent = components?.fetchComponent ?? createFetchComponent()

  const cache = new LRUCache<string, CachedResponseData>({ max, ttl })

  /**
   * Checks if a request method should be cached
   *
   * @param init - Request initialization options
   * @returns True if the method is cacheable
   */
  function isCacheable(init?: Parameters<IFetchComponent['fetch']>[1]): boolean {
    const method = (init?.method ?? 'GET').toUpperCase()
    return cacheableMethods.includes(method)
  }

  /**
   * Creates a Response from cached data
   *
   * @param cachedData - The cached response data
   * @returns A new Response object
   */
  function createResponseFromCache(cachedData: CachedResponseData): Response {
    return new Response(cachedData.body, {
      status: cachedData.status,
      statusText: cachedData.statusText,
      headers: cachedData.headers
    })
  }

  /**
   * Converts a Response to cacheable data
   *
   * @param response - The response to convert
   * @returns The cached response data
   */
  async function responseToCacheData(response: Response): Promise<CachedResponseData> {
    const body = await response.buffer()
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

  return {
    /**
     * Fetches a resource with caching support
     *
     * For cacheable methods (GET by default), this method will:
     * - Return cached response if available and not expired
     * - Perform network request on cache miss
     * - Cache successful responses (ok: true) or responses with status in cacheableStatusCodes
     * - Return other error responses (ok: false) without caching
     *
     * For non-cacheable methods, this method passes through to the underlying fetch.
     *
     * @param url - The URL to fetch
     * @param init - Optional request initialization options
     * @returns Promise resolving to the Response
     */
    async fetch(
      url: Parameters<IFetchComponent['fetch']>[0],
      init?: Parameters<IFetchComponent['fetch']>[1]
    ): ReturnType<IFetchComponent['fetch']> {
      // Non-cacheable methods bypass the cache
      if (!isCacheable(init)) {
        return fetchComponent.fetch(url, init)
      }

      const key = getCacheKey(url, init)

      // Check cache first
      const cachedData = cache.get(key)
      if (cachedData) {
        return createResponseFromCache(cachedData)
      }

      // Cache miss - fetch from network
      const response = await fetchComponent.fetch(url, init)

      // Cache successful responses or responses with cacheable status codes
      const shouldCache = response.ok || cacheableStatusCodes.includes(response.status)
      if (shouldCache) {
        const cacheData = await responseToCacheData(response)
        cache.set(key, cacheData)
        return createResponseFromCache(cacheData)
      }

      // Return other error responses without caching
      return response
    }
  }
}
