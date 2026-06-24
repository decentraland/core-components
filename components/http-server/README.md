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
