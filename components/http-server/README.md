# @dcl/http-server

forked from https://github.com/well-known-components/http-server

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
