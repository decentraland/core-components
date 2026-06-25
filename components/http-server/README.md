# @dcl/http-server

forked from https://github.com/well-known-components/http-server

## Server options

`createServerComponent(components, options)` accepts a `Partial<IHttpServerOptions>`
to tune the underlying Node server:

```ts
import { createServerComponent } from '@dcl/http-server'

const server = await createServerComponent(
  { config, logs },
  {
    // Reject request bodies larger than 1 MiB.
    maxBodySize: 1024 * 1024,
    // Abort a request whose headers + body don't arrive within 30s.
    requestTimeout: 30_000,
    maxHeadersCount: 100,
    maxRequestsPerSocket: 1000,
    cors: { origin: '*' }
  }
)
```

| Option | Maps to | Description |
| --- | --- | --- |
| `maxBodySize` | _(enforced by this component)_ | Maximum size, in bytes, of an incoming request body. A request that declares a larger `Content-Length` is rejected with `413 Payload Too Large` before the body is read; a body that omits or under-declares its length (e.g. chunked transfer-encoding) is capped with the same `413` while streaming. Unset means no limit. |
| `cors` | _(CORS middleware)_ | CORS configuration applied as middleware. |
| `keepAliveTimeout` | `server.keepAliveTimeout` | Idle keep-alive socket timeout in ms (default `70000`). |
| `headersTimeout` | `server.headersTimeout` | Time to receive the complete headers in ms (default `75000`). |
| `requestTimeout` | `server.requestTimeout` | Time to receive the entire request in ms. `0` disables it. |
| `maxHeadersCount` | `server.maxHeadersCount` | Maximum number of request headers. `0` means unlimited. |
| `maxRequestsPerSocket` | `server.maxRequestsPerSocket` | Max requests served per keep-alive socket. Unset/`0` means unlimited. |

A `maxBodySize` rejection produces a `413` that a handler can also surface itself: when
a handler reads an over-limit body inside the middleware chain (e.g. `await ctx.request.json()`),
the read rejects and the error middleware maps it to a `413` response.

`maxBodySize` must be a positive integer when provided — `createServerComponent` throws on
`0`, negative or fractional values (omit the option for "no limit"). When `cors` is also
configured, the up-front `Content-Length` rejection still carries the actual-response CORS
headers, so a cross-origin client can read the `413`.

### Reading the request body under a `maxBodySize`

The streaming limit is enforced as `ctx.request.body` is consumed, so it only turns into a `413`
if your handler actually reads the body **and propagates stream errors**. Reading it with
`await ctx.request.json()` / `.text()` / `.arrayBuffer()` or `for await (… of ctx.request.body)`
does this for you — the read rejects with the `413` and the error middleware maps it to a response.

If you instead **pipe** `ctx.request.body` into another stream (e.g. a multipart parser like
`busboy`), remember that `Readable.prototype.pipe` does **not** forward *source* errors to the
destination. Attach an error handler to the adapted source, or a body-stream error — a client
abort *or* the `maxBodySize` limiter emitting its `413` — surfaces as an unhandled error (and can
crash the process):

```ts
import { Readable } from 'stream'

const body = Readable.fromWeb(ctx.request.body as any)
// Forward source errors (client abort, or the maxBodySize 413) so the parser rejects cleanly.
body.on('error', (err) => parser.destroy(err))
body.pipe(parser)
```

Requests that declare a `Content-Length` over the limit — the usual case for `multipart/form-data`
uploads from browsers and `fetch` — are rejected up-front regardless of how the body is consumed.

### Per-route body-size limits

`maxBodySize` on `createServerComponent` is server-wide. For a tighter limit on specific routes, use
`createBodySizeLimitMiddleware(bytes)` and mount it on those routes:

```ts
import { createBodySizeLimitMiddleware } from '@dcl/http-server'

// allow at most 4 KB on this endpoint
router.post('/v1/notes', createBodySizeLimitMiddleware(4096), notesHandler)
```

It enforces the same dual check as the server-wide option: a request declaring a larger
`Content-Length` is rejected up front with `413 Payload Too Large`, and a body that omits or
under-declares its length (e.g. chunked) is capped while streaming — the body read by downstream
handlers errors with a `413` once the limit is crossed. `bytes` must be a positive integer or the
factory throws. It composes with the server-wide `maxBodySize` (the global cap still applies first).

## Returning a native `Response` from a handler

Handlers return the structural `IResponse` (Node `Readable`/`Buffer`/string/JSON
bodies). A native `Response` (as returned by `fetch`, with a web `ReadableStream`
body) is **not** an `IResponse` — returning one via `as any` lets
response-transforming middleware (e.g. CORS) silently drop its `status` and `body`.

When you have a native `Response` (typically proxying an upstream `fetch`), adapt it
at the boundary with `fromNativeResponse`:

```ts
import { fromNativeResponse } from '@dcl/http-server'

router.get('/proxy/:id', async (ctx) => {
  const upstream = await fetch(`${CONTENT_SERVER}/${ctx.params.id}`)
  return fromNativeResponse(upstream)
})
```

The body is streamed (not buffered), so proxying large responses stays
memory-safe. The passed `Response` is consumed by the returned stream — don't also
read it with `.text()`/`.json()`.

Plain handlers are unaffected — keep returning the structural shape directly:

```ts
return { status: 200, body: { hello: 'world' } }
```
