import { IHttpServerComponent } from '@dcl/core-commons'
import { assertValidMaxBodySize, exceedsContentLength, payloadTooLargeError } from './logic'

/**
 * Builds a web `TransformStream` that errors with a `413` once more than `maxBodySize` bytes have
 * passed through it, invoking `onExceeded` so the caller can react (e.g. tear the connection down).
 * Used to cap a request body that omits or under-declares its `Content-Length`.
 */
function createBodyStreamLimiter(
  maxBodySize: number,
  onExceeded: () => void
): TransformStream<Uint8Array, Uint8Array> {
  let received = 0
  return new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (received > maxBodySize) {
        onExceeded()
        controller.error(payloadTooLargeError())
      } else {
        controller.enqueue(chunk)
      }
    }
  })
}

// The `413` returned for an oversized body. `Connection: close` frees the socket: the rest of the
// body is never going to be read, so without it a client can keep streaming (or stall) and tie up
// the connection — Node won't reuse it but also won't tear it down on its own once a response is sent.
function payloadTooLargeResponse(): IHttpServerComponent.IResponse {
  return { status: 413, headers: { connection: 'close' }, body: 'Payload Too Large' }
}

/**
 * Creates a per-route middleware that rejects request bodies larger than `maxBodySize` bytes with
 * `413 Payload Too Large`.
 *
 * - A request that declares a larger `Content-Length` is rejected up front, before its body is read.
 * - A body that omits or under-declares its length (e.g. chunked transfer-encoding) is capped while
 *   streaming: once a downstream handler reads past the limit the body errors, and the middleware
 *   turns that into a `413` and closes the connection so the client can't keep streaming.
 *
 * Either way the `413` carries `Connection: close` so an oversized or stalled request can't tie up
 * the socket.
 *
 * Unlike the server-wide `maxBodySize` option (enforced at the transport layer for the whole
 * server), this middleware can be applied to individual routes for tighter, per-endpoint limits.
 *
 * @public
 */
export function createBodySizeLimitMiddleware<Context extends object = {}>(
  maxBodySize: number
): IHttpServerComponent.IRequestHandler<Context> {
  assertValidMaxBodySize(maxBodySize)

  return async (context, next) => {
    if (exceedsContentLength(context.request.headers.get('content-length'), maxBodySize)) {
      return payloadTooLargeResponse()
    }

    const body = context.request.body
    if (!body) {
      return next()
    }

    // Route the body through the limiter and replace the request so any downstream read flows
    // through it. `duplex: 'half'` is required by the fetch spec when constructing a `Request`
    // with a streaming body.
    let exceeded = false
    context.request = new Request(context.request.url, {
      method: context.request.method,
      headers: context.request.headers,
      body: body.pipeThrough(
        createBodyStreamLimiter(maxBodySize, () => {
          exceeded = true
        })
      ),
      duplex: 'half'
    } as RequestInit & { duplex: 'half' })

    // The limiter errors the body stream when the limit is crossed. A handler that reads the body
    // surfaces that as a thrown `413` (which would otherwise propagate to the error middleware
    // *without* `Connection: close`, leaving the socket open while the client keeps streaming). By
    // catching it here we guarantee the `413`-with-close response whenever the limit was exceeded,
    // regardless of whether the handler rethrew or swallowed the read error.
    try {
      const response = await next()
      return exceeded ? payloadTooLargeResponse() : response
    } catch (error) {
      if (exceeded) {
        return payloadTooLargeResponse()
      }
      throw error
    }
  }
}
