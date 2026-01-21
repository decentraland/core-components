import type { LRUCache } from 'lru-cache'

/**
 * Custom options specific to the cached fetch component (not from lru-cache)
 */
export type CachedFetchCustomOptions = {
  /** HTTP methods to cache. Defaults to ['GET'] */
  cacheableMethods?: string[]
  /**
   * Additional HTTP status codes to cache besides successful (2xx) responses.
   * Useful for caching known error states like 404 (Not Found) or 410 (Gone).
   * Defaults to [] (only cache successful responses).
   */
  cacheableErrorStatusCodes?: number[]
}

/**
 * Configuration options for the cached fetch component.
 * Includes all lru-cache options (as partial) plus custom options.
 */
export type CachedFetchComponentOptions = Partial<LRUCache.OptionsBase<string, CachedResponseData, unknown>> &
  CachedFetchCustomOptions

/**
 * Cached response data structure for internal storage
 */
export type CachedResponseData = {
  body: Buffer
  status: number
  statusText: string
  headers: Record<string, string>
}
