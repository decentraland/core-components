/**
 * Configuration options for the cached fetch component
 */
export type CachedFetchComponentOptions = {
  /** Maximum number of entries in the cache. Defaults to 1000 */
  max?: number
  /** Time-to-live for cached entries in milliseconds. Defaults to 300000 (5 minutes) */
  ttl?: number
  /** HTTP methods to cache. Defaults to ['GET'] */
  cacheableMethods?: string[]
  /**
   * Additional HTTP status codes to cache besides successful (2xx) responses.
   * Useful for caching known error states like 404 (Not Found) or 410 (Gone).
   * Defaults to [] (only cache successful responses).
   */
  cacheableStatusCodes?: number[]
}

/**
 * Cached response data structure for internal storage
 */
export type CachedResponseData = {
  body: Buffer
  status: number
  statusText: string
  headers: Record<string, string>
}
