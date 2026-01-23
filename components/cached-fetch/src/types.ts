import * as fetch from 'node-fetch'
import type { LRUCache } from 'lru-cache'

export type Request = fetch.Request | fetch.RequestInfo

export type RequestInit = fetch.RequestInit

export type Response = fetch.Response

// ============================================================================
// Component Options
// ============================================================================

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
  /**
   * Request headers to include in cache key generation.
   * Useful for caching responses that vary by headers like Authorization.
   * Header names are case-insensitive.
   * Defaults to [] (no headers included in cache key).
   */
  cacheKeyHeaders?: string[]
}

/**
 * Configuration options for the cached fetch component.
 * Includes all lru-cache options (as partial) plus custom options.
 */
export type CachedFetchComponentOptions = Partial<LRUCache.OptionsBase<string, CachedResponseData, unknown>> &
  CachedFetchCustomOptions

/**
 * Cached response data structure for internal storage
 * Uses Uint8Array for cross-platform compatibility (Node.js and browser)
 */
export type CachedResponseData = {
  body: Uint8Array
  status: number
  statusText: string
  headers: Record<string, string>
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a Request-like object using duck typing.
 * Works with any fetch implementation (node-fetch, native fetch, undici, etc.)
 */
export function isRequestLike(value: unknown): value is { url: string; method: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'url' in value &&
    'method' in value &&
    typeof (value as { url: unknown }).url === 'string' &&
    typeof (value as { method: unknown }).method === 'string'
  )
}

/**
 * Type guard to check if a value is Headers-like (has forEach method)
 */
export function isHeadersLike(value: unknown): value is Headers {
  return (
    typeof value === 'object' &&
    value !== null &&
    'forEach' in value &&
    typeof (value as Record<string, unknown>).forEach === 'function'
  )
}

/**
 * Type guard to check if a value is URLSearchParams-like
 */
export function isURLSearchParamsLike(value: unknown): value is URLSearchParams {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value &&
    'entries' in value &&
    'append' in value
  )
}

/**
 * Type guard to check if a value is ArrayBuffer-like
 */
export function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'byteLength' in value &&
    typeof (value as ArrayBuffer).byteLength === 'number' &&
    !('buffer' in value) // Exclude TypedArrays which have a buffer property
  )
}
