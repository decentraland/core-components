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
 * Creates a fetch component that only resolves local testing URLs (paths
 * starting with `/`), targeting the host/port resolved from the config. Backed
 * by the native global `fetch`.
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
      if (typeof url !== 'string' || !url.startsWith('/')) {
        throw new Error('localFetch only works for local testing-URLs')
      }

      const { identity, metadata, ...requestInit } = init ?? {}

      if (!identity) {
        return fetch(baseUrl + url, requestInit)
      }

      const method = (requestInit.method ?? 'GET').toUpperCase()
      const headers = normalizeHeaders(requestInit.headers)
      Object.assign(headers, getSignedAuthHeaders(method, url, metadata ?? {}, identity))

      return fetch(baseUrl + url, { ...requestInit, headers })
    }
  }
}
