// Public helpers exposed in the API
import { Readable } from 'stream'
import type { IHttpServerComponent } from '@dcl/core-commons'

/**
 * Adapts a native `Response` (e.g. one obtained from `fetch`) into the server's
 * `IResponse` shape so it can be returned from a handler and flow safely through
 * the middleware pipeline.
 *
 * The pipeline carries the structural `IResponse` (Node `Readable`/`Buffer` bodies).
 * A native `Response` has a web `ReadableStream` body and is *not* assignable to
 * `IResponse`; forcing one in via `as any` lets response-transforming middleware
 * corrupt it — e.g. CORS does `{ ...response }`, and a `Response`'s `status`/`body`
 * are prototype getters, so the spread drops them (served as a bodiless `200`).
 * Convert at the boundary instead:
 *
 * ```ts
 * router.get('/proxy', async () => fromNativeResponse(await fetch(upstreamUrl)))
 * ```
 *
 * The body is streamed (via `Readable.fromWeb`), not buffered, so proxying large
 * responses stays memory-safe. The passed `Response`'s body is taken over by the
 * returned stream — don't also read it with `.text()`/`.json()`.
 *
 * @public
 */
export function fromNativeResponse(response: Response): IHttpServerComponent.IResponse {
  // Copy the headers and drop the framing/encoding descriptors that no longer
  // describe the outgoing body: `fetch` has already decoded the body, and it will be
  // re-streamed (chunked) downstream, so forwarding the upstream `Content-Encoding`
  // (body is now plaintext → double-decode), `Content-Length` (length changed → the
  // piped stream mismatches it → truncation/hang) or hop-by-hop `Transfer-Encoding`
  // would corrupt the response. This is the classic decoded-proxy bug.
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  headers.delete('transfer-encoding')

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    // Only adapt a body that is present, unread and unlocked: `Readable.fromWeb`
    // throws on a locked stream, so a response whose body a caller already took a
    // reader for is forwarded without a body rather than crashing normalization.
    body:
      response.body && !response.bodyUsed && !response.body.locked
        ? (Readable.fromWeb(response.body as any) as Readable)
        : undefined
  }
}
