import type { IConfigComponent } from '@well-known-components/interfaces'
import type { RequestOptions } from '@dcl/core-commons'
import { getSignedAuthHeaders } from './auth'
import type { Identity } from './auth'

// Starting TCP port for test listeners. Seed it from the jest worker id so suites
// running in parallel workers don't collide on the same port.
/* istanbul ignore next */
let lastUsedPort = 19000 + parseInt(process.env.JEST_WORKER_ID || '1', 10) * 1000

function getPort() {
  lastUsedPort += 1
  return lastUsedPort
}

/**
 * Default server config (host + an auto-incrementing port) for tests that spin
 * up a real HTTP server.
 * @public
 */
export const defaultServerConfig = () => ({
  HTTP_SERVER_HOST: '0.0.0.0',
  HTTP_SERVER_PORT: String(getPort())
})

/**
 * Request options accepted by the local fetch component. Extends the standard
 * options with an optional `identity`: when present, the request is signed with
 * the signed-fetch pattern (ADR-44) and `metadata` is included in the signature.
 * @public
 */
export type LocalFetchRequestOptions = RequestOptions & {
  /** When provided, the request is signed with this identity's ephemeral key. */
  identity?: Identity
  /** Metadata included in the signed payload. Ignored when `identity` is absent. */
  metadata?: Record<string, any>
}

/**
 * A fetch component for local testing URLs that can optionally sign requests.
 * @public
 */
export type ILocalFetchComponent = {
  fetch(url: string | URL | Request, init?: LocalFetchRequestOptions): Promise<Response>
}

/**
 * Resolves the local request target to a path (e.g. `/route?x=1`). A `string`
 * must be a local path starting with `/`; `URL` and `Request` inputs are reduced
 * to their path (pathname + search + hash) since the component always targets the
 * configured local test server and ignores any host they carry.
 */
function toLocalPath(url: string | URL | Request): string {
  if (typeof url === 'string') {
    if (!url.startsWith('/')) {
      throw new Error('localFetch only works for local testing-URLs')
    }
    return url
  }

  const { pathname, search, hash } = url instanceof Request ? new URL(url.url) : url
  return `${pathname}${search}${hash}`
}

function normalizeHeaders(input?: RequestOptions['headers']): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!input) return headers
  if (input instanceof Headers) {
    input.forEach((value, key) => {
      headers[key] = value
    })
  } else if (Array.isArray(input)) {
    for (const [key, value] of input) {
      headers[key] = value
    }
  } else {
    Object.assign(headers, input)
  }
  return headers
}

/**
 * Creates a fetch component that only resolves local testing URLs, targeting the
 * host/port resolved from the config. Backed by the native global `fetch`.
 *
 * The request target may be a local path string (must start with `/`), a `URL`,
 * or a `Request`; for `URL`/`Request` only the path is used (any host is ignored,
 * since requests always go to the configured local server).
 *
 * Pass an `identity` in the request options to send an authenticated (signed)
 * request following the signed-fetch pattern (ADR-44); omit it for a plain
 * request.
 * @public
 */
export async function createLocalFetchComponent(config: IConfigComponent): Promise<ILocalFetchComponent> {
  const baseUrl = `http://${await config.requireString('HTTP_SERVER_HOST')}:${await config.requireNumber(
    'HTTP_SERVER_PORT'
  )}`

  return {
    async fetch(url: string | URL | Request, init?: LocalFetchRequestOptions): Promise<Response> {
      const path = toLocalPath(url)

      const { identity, metadata, ...requestInit } = init ?? {}

      if (!identity) {
        return fetch(baseUrl + path, requestInit)
      }

      const method = (requestInit.method ?? 'GET').toUpperCase()
      const headers = normalizeHeaders(requestInit.headers)
      Object.assign(headers, getSignedAuthHeaders(method, path, metadata ?? {}, identity))

      return fetch(baseUrl + path, { ...requestInit, headers })
    }
  }
}
