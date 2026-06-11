import type { IFetchComponent, IHttpServerComponent } from '@dcl/core-commons'
import { createServerHandler } from './server-handler'
import { NormalizedResponse } from './logic'
import { PassThrough, pipeline, Readable } from 'stream'
import type { WebSocket as WS } from 'ws'

/**
 * Converts the server's internal {@link NormalizedResponse} into a native `Response` for test callers.
 *
 * Informational statuses (e.g. `101` from a WebSocket upgrade) cannot be represented by the native
 * `Response` constructor (it only accepts 200–599), so we build a placeholder and shadow `status` to
 * preserve the value tests assert on.
 */
function toFetchResponse(res: NormalizedResponse): Response {
  const status = res.status ?? 200
  const isNullBodyStatus = status === 204 || status === 205 || status === 304
  let body: BodyInit | null = null
  if (status >= 200 && !isNullBodyStatus && res.body != null) {
    if (Buffer.isBuffer(res.body)) {
      body = res.body
    } else {
      // Node Readable -> web stream. Decouple via PassThrough (parity with a socket-backed body) and
      // route through `pipeline` so a source error destroys the PassThrough and surfaces to the body
      // reader instead of becoming an unhandled error.
      const passthrough = new PassThrough()
      pipeline(res.body, passthrough, () => undefined)
      body = Readable.toWeb(passthrough) as unknown as ReadableStream
    }
  }

  if (status < 200) {
    const response = new Response(null, { statusText: res.statusText, headers: res.headers })
    Object.defineProperty(response, 'status', { value: status, configurable: true })
    return response
  }

  return new Response(body, { status, statusText: res.statusText, headers: res.headers })
}

/** @alpha */
export type IWebSocketComponent<W = WS> = {
  createWebSocket(url: string, protocols?: string | string[]): W
}

/** @public */
export type ITestHttpServerComponent<Context extends object> = IHttpServerComponent<Context> &
  IFetchComponent & {
    resetMiddlewares(): void
  }

/**
 * @alpha
 */
export type TestServerWithWs = {
  ws(path: string, protocols: string | string[]): WS
}

/**
 * Creates a http-server component for tests
 * @public
 */
export function createTestServerComponent<Context extends object = {}>(): ITestHttpServerComponent<Context> {
  let currentContext: Context = {} as any

  const serverHandler = createServerHandler<Context>()

  const ret: ITestHttpServerComponent<Context> = {
    async fetch(url: any, initRequest?: any) {
      let req: Request

      if (url instanceof Request) {
        req = url
      } else {
        const tempHeaders = new Headers(initRequest?.headers)
        const hostname = tempHeaders.get('X-Forwarded-Host') || tempHeaders.get('host') || '0.0.0.0'
        const protocol = tempHeaders.get('X-Forwarded-Proto') == 'https' ? 'https' : 'http'
        let newUrl = new URL(protocol + '://' + hostname + url)
        try {
          newUrl = new URL(url, protocol + '://' + hostname)
        } catch {}

        let init = initRequest
        // The native `Request` constructor doesn't understand the `form-data` package (it would set a
        // `text/plain` body). Serialize it to a buffer and merge its multipart headers, the way
        // node-fetch used to, so multipart requests keep working against the in-memory test server.
        const maybeForm = initRequest?.body
        if (maybeForm && typeof maybeForm.getHeaders === 'function' && typeof maybeForm.getBuffer === 'function') {
          init = { ...initRequest, body: maybeForm.getBuffer(), headers: { ...maybeForm.getHeaders(), ...initRequest.headers } }
        }
        req = new Request(newUrl.toString(), init)
      }

      try {
        const res = await serverHandler.processRequest(currentContext, req)
        return toFetchResponse(res)
      } catch (error: any) {
        console.error(error)
        return new Response('DEV-SERVER-ERROR: ' + (error.stack || error.toString()), { status: 500 })
      }
    },
    use: serverHandler.use,
    setContext(ctx) {
      currentContext = Object.create(ctx)
    },
    resetMiddlewares: serverHandler.resetMiddlewares
  }
  return ret
}
