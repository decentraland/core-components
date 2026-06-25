import { IHttpServerComponent } from '@dcl/core-commons'
import { exceedsContentLength, payloadTooLargeError } from './logic'

/**
 * Builds a web `TransformStream` that errors with a `413` once more than `maxBodySize` bytes have
 * passed through it. Used to cap a request body that omits or under-declares its `Content-Length`.
 */
function createBodyStreamLimiter(maxBodySize: number): TransformStream<Uint8Array, Uint8Array> {
  let received = 0
  return new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (received > maxBodySize) {
        controller.error(payloadTooLargeError())
      } else {
        controller.enqueue(chunk)
      }
    }
  })
}

/**
 * Creates a per-route middleware that rejects request bodies larger than `maxBodySize` bytes with
 * `413 Payload Too Large`.
 *
 * - A request that declares a larger `Content-Length` is rejected up front, before its body is read.
 * - A body that omits or under-declares its length (e.g. chunked transfer-encoding) is capped while
 *   streaming: the request body handed to downstream handlers errors with the same `413` once the
 *   limit is crossed, which the error middleware maps to a `413` response.
 *
 * Unlike the server-wide `maxBodySize` option (enforced at the transport layer for the whole
 * server), this middleware can be applied to individual routes for tighter, per-endpoint limits.
 *
 * @public
 */
export function createBodySizeLimitMiddleware<Context extends object = {}>(
  maxBodySize: number
): IHttpServerComponent.IRequestHandler<Context> {
  if (!Number.isInteger(maxBodySize) || maxBodySize < 1) {
    throw new Error(`Invalid maxBodySize: expected a positive integer number of bytes, got ${maxBodySize}`)
  }

  return async (context, next) => {
    if (exceedsContentLength(context.request.headers.get('content-length'), maxBodySize)) {
      return { status: 413, body: 'Payload Too Large' }
    }

    const body = context.request.body
    if (body) {
      // Route the body through the limiter and replace the request so any downstream read flows
      // through it. `duplex: 'half'` is required by the fetch spec when constructing a `Request`
      // with a streaming body.
      context.request = new Request(context.request.url, {
        method: context.request.method,
        headers: context.request.headers,
        body: body.pipeThrough(createBodyStreamLimiter(maxBodySize)),
        duplex: 'half'
      } as RequestInit & { duplex: 'half' })
    }

    return next()
  }
}
