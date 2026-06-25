import { Readable, Stream, Transform } from 'stream'
import * as http from 'http'
import * as https from 'https'
import destroy from 'destroy'
import onFinished from 'on-finished'
import type { IHttpServerComponent } from '@dcl/core-commons'
import type { IHttpServerOptions } from './types'
import createHttpError, { HttpError } from 'http-errors'
import { Middleware } from './middleware'
import { getWebSocketCallback, upgradeWebSocketResponse, withWebSocketCallback } from './ws'
import { fromNativeResponse } from './helpers'

/**
 * @internal
 * The normalized, transport-ready form of a handler response. Unlike a web `Response` it keeps the
 * body as a Node `Buffer`/`Readable` so it can be written or piped straight to the Node
 * `http.ServerResponse`, and it can represent informational statuses such as `101` (WebSocket
 * upgrade) that the native `Response` constructor rejects.
 */
export type NormalizedResponse = {
  status?: number
  statusText?: string
  headers: Headers
  body?: Buffer | Readable
}

/**
 * @internal
 */
export function getServer(
  options: Partial<IHttpServerOptions>,
  listener: http.RequestListener
): http.Server | https.Server {
  let server: http.Server | https.Server
  // Note: these branches must be mutually exclusive. A plain `if (https) ... if (http) ... else`
  // would let the trailing `else` overwrite an https server whenever `http` is absent.
  if ('https' in options && options.https) {
    server = https.createServer(options.https, listener)
  } else if ('http' in options && options.http) {
    server = http.createServer(options.http, listener)
  } else {
    server = http.createServer(listener)
  }

  server.keepAliveTimeout = options.keepAliveTimeout ?? 70_000
  server.headersTimeout = options.headersTimeout ?? 75_000
  if (options.requestTimeout !== undefined) server.requestTimeout = options.requestTimeout
  if (options.maxHeadersCount !== undefined) server.maxHeadersCount = options.maxHeadersCount
  if (options.maxRequestsPerSocket !== undefined) server.maxRequestsPerSocket = options.maxRequestsPerSocket
  return server
}

/**
 * @internal
 * Builds the error thrown when a request body exceeds the configured `maxBodySize`. It is an
 * `HttpError`, so `coerceErrorsMiddleware` maps it to a `413 Payload Too Large` response when a
 * handler reads the body within the middleware chain.
 */
export function payloadTooLargeError(): HttpError {
  return createHttpError(413, 'Payload Too Large')
}

/**
 * @internal
 * Validates a `maxBodySize` option, throwing if it is defined but not a positive integer number of
 * bytes. A negative, fractional or zero limit would silently reject every request body.
 */
export function assertValidMaxBodySize(maxBodySize: number | undefined): void {
  if (maxBodySize !== undefined && (!Number.isInteger(maxBodySize) || maxBodySize < 1)) {
    throw new Error(`Invalid maxBodySize: expected a positive integer number of bytes, got ${maxBodySize}`)
  }
}

/**
 * @internal
 * Parses an incoming `Content-Length` header and reports whether it declares a body larger than
 * `maxBodySize`. The comparison is strict (`>`), so a declared length of exactly `maxBodySize` is
 * allowed. A missing, empty or non-numeric header is treated as "not exceeding" — those bodies
 * (including chunked transfer-encoding) are caught instead by {@link createBodySizeLimiter} while
 * streaming.
 */
export function exceedsContentLength(contentLength: string | null | undefined, maxBodySize: number): boolean {
  if (contentLength === null || contentLength === undefined || contentLength === '') return false
  const declared = Number(contentLength)
  return Number.isFinite(declared) && declared > maxBodySize
}

/**
 * @internal
 * Wraps a Node request stream so it errors with a `413` once more than `maxBodySize` bytes have
 * flowed through. This guards against bodies that omit or under-declare `Content-Length` (e.g.
 * chunked transfer-encoding), which the up-front header check cannot catch. A handler that reads
 * the body within the middleware chain surfaces the error as a clean `413` (via
 * `coerceErrorsMiddleware`).
 */
export function createBodySizeLimiter(source: Readable, maxBodySize: number): Readable {
  let received = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > maxBodySize) {
        callback(payloadTooLargeError())
      } else {
        callback(null, chunk)
      }
    }
  })

  // Forward a failure of the underlying request (e.g. a client abort) to the limiter so the
  // handler's body read rejects. The reverse is intentionally not wired: destroying `source` on a
  // limiter error would tear down the socket and prevent the `413` response from being written —
  // `pipe` already unpipes `source` when the limiter errors, which stops it from feeding more data.
  source.once('error', (err) => limiter.destroy(err))
  source.pipe(limiter)

  return limiter
}

const NAME = Symbol.toStringTag
/**
 * Check if `object` is a W3C `Blob` object (which `File` inherits from)
 *
 * @internal
 */
export const isBlob = (object: any): object is Blob => {
  return (
    object !== null &&
    typeof object === 'object' &&
    typeof object.arrayBuffer === 'function' &&
    typeof object.type === 'string' &&
    typeof object.stream === 'function' &&
    typeof object.constructor === 'function' &&
    /^(Blob|File)$/.test(object[NAME])
  )
}

/**
 * @internal
 */
export function success(data: NormalizedResponse, res: http.ServerResponse) {
  if (data.statusText) res.statusMessage = data.statusText
  if (data.status) res.statusCode = data.status

  data.headers.forEach((value: string, key: string) => {
    // Set-Cookie is handled separately below. Multiple cookies must be emitted as distinct
    // `Set-Cookie` headers; setting them one-by-one here would overwrite (res.setHeader replaces
    // by name) and leave only the last cookie.
    if (key !== 'set-cookie') {
      res.setHeader(key, value)
    }
  })

  // `res.setHeader` accepts an array, which Node serializes as one `Set-Cookie` header per element.
  const setCookies = typeof data.headers.getSetCookie === 'function' ? data.headers.getSetCookie() : []
  if (setCookies.length > 0) {
    res.setHeader('set-cookie', setCookies)
  }

  const body = data.body

  if (Buffer.isBuffer(body)) {
    res.end(body)
  } else if (body && typeof (body as Readable).pipe === 'function') {
    body.on('error', (err) => res.destroy(err))
    body.pipe(res)

    // Note: for context about why this is necessary, check https://github.com/nodejs/node/issues/1180
    onFinished(res, () => destroy(body))
  } else if (body !== undefined && body !== null) {
    throw new Error('Unknown response body')
  } else {
    res.end()
  }
}

// @internal
export function getDefaultMiddlewares(): Middleware<any>[] {
  return [coerceErrorsMiddleware]
}

// Caches the `URL` parsed while building a request so `contextFromRequest` can reuse
// it instead of re-parsing `request.url` on every request. Weakly keyed, so an entry
// disappears together with its request.
const parsedUrlByRequest = new WeakMap<IHttpServerComponent.IRequest, URL>()

export const getRequestFromNodeMessage = <T extends http.IncomingMessage & { originalUrl?: string }>(
  request: T,
  host: string,
  maxBodySize?: number
): IHttpServerComponent.IRequest => {
  const headers = new Headers()

  for (let key in request.headers) {
    if (request.headers.hasOwnProperty(key)) {
      const h = request.headers[key]
      if (typeof h == 'string') {
        headers.append(key, h)
      } else if (Array.isArray(h)) {
        h.forEach(($) => headers.append(key, $))
      }
    }
  }

  const method = request.method!.toUpperCase()
  const requestInit: RequestInit & { duplex?: 'half' } = {
    headers,
    method
  }

  // Only stream a body when the incoming Node message hasn't been consumed yet.
  // If something already read it (e.g. an Express body-parser running before this
  // is called), `Readable.toWeb` yields a disturbed stream and the native
  // `Request` constructor throws "Response body object should not be disturbed or
  // locked". In that case the parsed body is exposed by the caller through other
  // means, so skipping it here is safe.
  const bodyAlreadyConsumed = request.readableEnded || request.readableDidRead
  if (method != 'GET' && method != 'HEAD' && !bodyAlreadyConsumed) {
    // The native `Request` body must be a web `ReadableStream`. Adapt the incoming Node message
    // stream; `duplex: 'half'` is required by the fetch spec when streaming a request body.
    // When a `maxBodySize` is configured the stream is first routed through a limiter that errors
    // once the body exceeds it, catching bodies that omit or under-declare `Content-Length`.
    const bodySource = maxBodySize === undefined ? request : createBodySizeLimiter(request, maxBodySize)
    requestInit.body = Readable.toWeb(bodySource) as unknown as ReadableStream
    requestInit.duplex = 'half'
  }

  const protocol = headers.get('X-Forwarded-Proto') == 'https' ? 'https' : 'http'
  const baseUrl = protocol + '://' + (headers.get('X-Forwarded-Host') || headers.get('host') || host || '0.0.0.0')

  // Note: Express.js overwrite `req.url` freely for internal routing
  // purposes and retains the original value on `req.originalUrl`
  // @see https://expressjs.com/en/api.html#req.originalUrl
  const originalUrl = request.originalUrl ?? request.url!
  // Parse the URL once. The two-arg form resolves `originalUrl` against `baseUrl`;
  // only fall back to string concatenation if that throws on a malformed input.
  let url: URL
  try {
    url = new URL(originalUrl, baseUrl)
  } catch {
    url = new URL(baseUrl + originalUrl)
  }
  const ret = new Request(url.toString(), requestInit)

  // Cache the parsed URL so `contextFromRequest` doesn't re-parse `request.url`.
  parsedUrlByRequest.set(ret, url)

  return ret
}

export const coerceErrorsMiddleware: Middleware<any> = async (_, next) => {
  try {
    return await next()
  } catch (e: any) {
    if (
      e instanceof HttpError ||
      (('status' in e || 'statusCode' in e) && (typeof e.status == 'number' || typeof e.statusCode == 'number'))
    ) {
      return {
        status: e.status || e.statusCode,
        body: e.body || e.message,
        headers: e.headers
      }
    }
    throw e
  }
}

function respondBuffer(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  response: IHttpServerComponent.IResponse,
  mutableHeaders: Headers
): NormalizedResponse {
  // TODO: test
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer)
  mutableHeaders.set('Content-Length', body.byteLength.toFixed())
  return { status: response.status, statusText: response.statusText, headers: mutableHeaders, body }
}

function respondJson(
  json: any,
  response: IHttpServerComponent.IResponse,
  mutableHeaders: Headers
): NormalizedResponse {
  // TODO: test
  if (!mutableHeaders.has('content-type')) {
    mutableHeaders.set('content-type', 'application/json')
  }
  return respondString(JSON.stringify(json), response, mutableHeaders)
}

function respondString(
  txt: string,
  response: IHttpServerComponent.IResponse,
  mutableHeaders: Headers
): NormalizedResponse {
  // TODO: test
  // TODO: accept encoding
  const returnEncoding = 'utf-8'
  const retBuffer = Buffer.from(txt, returnEncoding)

  if (!mutableHeaders.has('content-type')) {
    mutableHeaders.set('content-type', `text/plain; charset=${returnEncoding}`)
  }

  return respondBuffer(retBuffer, response, mutableHeaders)
}

const initialResponse: IHttpServerComponent.IResponse = {
  status: 404,
  body: 'Not found'
}

/**
 * Default middleware
 * @public
 */
export async function defaultHandler(): Promise<IHttpServerComponent.IResponse> {
  return initialResponse
}

// @internal
export function normalizeResponseBody(
  request: IHttpServerComponent.IRequest,
  response: IHttpServerComponent.IResponse
): NormalizedResponse {
  if (!response) {
    // Not Implemented
    return { status: 501, statusText: 'Server did not produce a valid response', headers: new Headers() }
  }

  if (response.status == 101) {
    const cb = getWebSocketCallback(response)
    return withWebSocketCallback(
      { status: 101, headers: new Headers(response.headers as HeadersInit) } as NormalizedResponse,
      cb
    )
  }

  if (response instanceof Response) {
    // Route native Responses through the same boundary adapter handlers use, so both
    // paths normalize identically (incl. dropping stale content-encoding/length).
    return normalizeResponseBody(request, fromNativeResponse(response))
  }

  const is1xx = response.status && response.status >= 100 && response.status < 200
  const is204 = response.status == 204
  const is304 = response.status == 304
  const isHEAD = request.method == 'HEAD'

  const mutableHeaders = new Headers(response.headers as HeadersInit)

  if (is204 || is304) {
    // TODO: TEST this code path
    mutableHeaders.delete('Content-Type')
    mutableHeaders.delete('Content-Length')
    mutableHeaders.delete('Transfer-Encoding')
  }

  // https://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html#sec4.4
  // the following responses must not contain any content nor content-length
  if (is1xx || is204 || is304 || isHEAD) {
    // TODO: TEST this code path
    return { status: response.status, statusText: response.statusText, headers: mutableHeaders }
  }

  if (Buffer.isBuffer(response.body)) {
    return respondBuffer(response.body, response, mutableHeaders)
  } else if (response.body instanceof ArrayBuffer || response.body instanceof Uint8Array) {
    return respondBuffer(response.body, response, mutableHeaders)
  } else if (typeof response.body == 'string') {
    return respondString(response.body, response, mutableHeaders)
  } else if (response.body instanceof Stream) {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: mutableHeaders,
      body: response.body as Readable
    }
  } else if (response.body != undefined) {
    // TODO: test
    return respondJson(response.body, response, mutableHeaders)
  }

  // Applications SHOULD use this field to indicate the transfer-length of the
  // message-body, unless this is prohibited by the rules in section 4.4.
  // (https://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html#sec4.4)
  if (!mutableHeaders.has('content-length')) {
    mutableHeaders.set('content-length', '0')
  }

  return { status: response.status, statusText: response.statusText, headers: mutableHeaders }
}

/**
 * @internal
 */
export function contextFromRequest<Ctx extends object>(baseCtx: Ctx, request: IHttpServerComponent.IRequest) {
  const newContext: IHttpServerComponent.DefaultContext<Ctx> = Object.create(baseCtx)

  // hydrate context with the request
  newContext.request = request
  // Reuse the URL parsed when the request was built; only re-parse for requests that
  // didn't pass through `getRequestFromNodeMessage` (e.g. ones built directly in tests).
  newContext.url = parsedUrlByRequest.get(request) ?? new URL(request.url)

  return newContext
}
