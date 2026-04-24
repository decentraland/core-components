import { createHash } from 'crypto'
import {
  isRequestLike,
  isHeadersLike,
  isURLSearchParamsLike,
  isArrayBufferLike,
  type Request,
  type RequestInit
} from './types'

/**
 * Extracts the HTTP method from a request
 * Checks Request object first, then init options, defaults to GET
 *
 * @param url - The request URL or Request object
 * @param init - Optional request initialization options
 * @returns The HTTP method in uppercase
 */
export function getMethod(url: Request, init?: RequestInit): string {
  // If url is a Request-like object, it may have a method
  if (isRequestLike(url)) {
    return url.method.toUpperCase()
  }
  return init?.method?.toUpperCase() ?? 'GET'
}

/**
 * Extracts the URL string from a request
 *
 * @param url - The request URL or Request object
 * @returns The URL as a string
 */
export function getUrlString(url: Request): string {
  if (typeof url === 'string') {
    return url
  }
  if (isRequestLike(url)) {
    return url.url
  }
  return url.toString()
}

/**
 * Converts headers to an array of [key, value] pairs, normalizing different formats
 */
function headersToEntries(headers: RequestInit['headers']): Array<[string, string]> {
  if (!headers) {
    return []
  }

  if (Array.isArray(headers)) {
    return headers.map(([key, value]) => [key, value] as [string, string])
  }

  if (isHeadersLike(headers)) {
    const entries: Array<[string, string]> = []
    headers.forEach((value, key) => entries.push([key, value]))
    return entries
  }

  // Plain object
  return Object.entries(headers).map(([key, value]): [string, string] => {
    const valueStr = Array.isArray(value) ? value.join(', ') : value ?? ''
    return [key, valueStr]
  })
}

/**
 * Extracts header values for cache key generation
 *
 * @param init - Request initialization options
 * @param headerNames - Header names to extract (case-insensitive)
 * @returns Sorted header key-value pairs as a string
 */
export function extractHeadersForCacheKey(init: RequestInit | undefined, headerNames: string[]): string {
  if (!init?.headers || headerNames.length === 0) {
    return ''
  }

  const lowerCaseHeaderNames = new Set(headerNames.map((h) => h.toLowerCase()))

  const headerValues = headersToEntries(init.headers)
    .filter(([key]) => lowerCaseHeaderNames.has(key.toLowerCase()))
    .map(([key, value]) => `${key.toLowerCase()}:${value}`)
    .sort()

  return headerValues.join('|')
}

/**
 * Converts a request body to a string for hashing
 *
 * @returns The body as a string, or empty string if it can't be converted
 */
function bodyToString(body: RequestInit['body']): string {
  if (typeof body === 'string') {
    return body
  }

  if (isURLSearchParamsLike(body)) {
    return body.toString()
  }

  if (Buffer.isBuffer(body)) {
    return body.toString('base64')
  }

  if (isArrayBufferLike(body)) {
    return Buffer.from(body).toString('base64')
  }

  // Streams and other types can't be reliably converted
  return ''
}

/**
 * Hashes a request body for cache key generation
 *
 * @param body - The request body
 * @returns A hash string of the body, or empty string if no body or unhashable
 */
export function hashBody(body: RequestInit['body']): string {
  if (!body) {
    return ''
  }

  const bodyString = bodyToString(body)

  return createHash('sha256').update(bodyString).digest('hex').slice(0, 16)
}
