# @dcl/http-server

## 2.2.1

### Patch Changes

- f2257d2: Stop the published types from importing `ws`, so consumers no longer need `@types/ws` (or `skipLibCheck: true`) to typecheck against `@dcl/http-server`.

  `ws` is only a dev/type dependency, but `WebSocketCallback`, `IWebSocketComponent` and `TestServerWithWs` referenced its `WebSocket` type, leaking `import type { WebSocket } from 'ws'` into `dist/ws.d.ts` and `dist/test-component.d.ts`. Consumers that don't install `@types/ws` then failed with `TS2307: Cannot find module 'ws'` whenever `skipLibCheck` was off, which forced them to enable it. These (deprecated/alpha) WebSocket types are now generic with an `any` default, so the published `.d.ts` no longer references `ws`; consumers that use them can still opt into precise typing via `WebSocketCallback<import('ws').WebSocket>`.

## 2.2.0

### Minor Changes

- 2c6e4b8: Add `createBodySizeLimitMiddleware(bytes)`: a per-route middleware that rejects request bodies larger than the given size with `413 Payload Too Large`. A request declaring a larger `Content-Length` is rejected up front; a body that omits or under-declares its length (e.g. chunked transfer-encoding) is capped while streaming (the body read by downstream handlers errors with a `413` once the limit is crossed). Either way the `413` sets `Connection: close`, so an oversized or stalled request can't tie up the socket. Unlike the server-wide `maxBodySize` option, it can be applied to individual routes for tighter, per-endpoint limits, and composes with the global cap. The size must be a positive integer or the factory throws.
- 2c6e4b8: `createServerComponent`: add more initialization options. New `maxBodySize` caps incoming request bodies — requests declaring a larger `Content-Length` are rejected with `413 Payload Too Large` before the body is read, and bodies that omit or under-declare their length (e.g. chunked transfer-encoding) are capped with the same `413` while streaming. `maxBodySize` is validated as a positive integer at construction, and when `cors` is configured the up-front rejection carries the actual-response CORS headers so cross-origin clients can read the `413`. Both the up-front and streaming `413`s set `Connection: close`, so a client that declares an oversized body and stalls — or keeps streaming a chunked body past the limit — can't tie up the socket. Also exposes the Node server tunables `requestTimeout`, `maxHeadersCount` and `maxRequestsPerSocket` (alongside the existing `keepAliveTimeout`/`headersTimeout`). Fixes a latent bug in `getServer` where providing `https` options was silently overwritten by the plain-http fallback, so `https` servers are now created as intended. Also fixes the HTTP metrics middleware (`instrumentHttpServerWithPromClientRegistry`): thrown error responses were labelled `code="200"` because the metrics middleware observed the exception before `coerceErrorsMiddleware` mapped it to a response — they are now labelled with the real status (e.g. a thrown `413`/`404`, or `500` for an unmapped error).

## 2.1.0

### Minor Changes

- f416044: add `fromNativeResponse(response)` and harden native-`Response` handling.

  A native `Response` (e.g. from `fetch`) is not assignable to the server's `IResponse` (its body is a web `ReadableStream`), yet it was handled at runtime — so one forced in via a cast would be silently corrupted by response-transforming middleware (the CORS middleware's `{ ...response }` drops a `Response`'s prototype-getter `status`/`body`, serving a bodiless `200`).
  - `fromNativeResponse(response)`: adapts a native `Response` into the structural `IResponse` for returning from a handler (e.g. proxying an upstream `fetch`). The body is streamed via `Readable.fromWeb` (not buffered); stale `Content-Encoding`/`Content-Length`/`Transfer-Encoding` headers are dropped — the body has already been decoded and is re-streamed, so forwarding them would double-decode or truncate the response; a locked/already-consumed body is forwarded as no body rather than throwing.
  - `normalizeResponseBody` routes native `Response`s through the same adapter, so the direct and proxied paths normalize identically.
  - the CORS middleware converts a native `Response` before re-wrapping it (and returns it untouched when there is no `Origin`), so it can no longer drop status/body.

### Patch Changes

- f416044: performance on the request hot path:
  - parse the request URL once. `getRequestFromNodeMessage` no longer builds a `URL` only to immediately discard it (it now parses with the two-arg `URL` form and falls back to concatenation only on failure), and `contextFromRequest` reuses that parsed `URL` instead of re-parsing `request.url`.
  - the CORS middleware returns the downstream response untouched when the request has no `Origin` header, skipping the per-response headers copy and object spread.
  - the router appends matched layer middlewares in place instead of `Array.concat` per layer (O(L) instead of O(L²)).

## 2.0.3

### Patch Changes

- 4848bf2: `getRequestFromNodeMessage`: don't attach an already-consumed request stream as the native `Request` body. When an upstream consumer (e.g. an Express `body-parser`) has already read the incoming message, wrapping the drained stream made the native `Request` constructor throw `Response body object should not be disturbed or locked`. The body is now only streamed when the incoming stream hasn't been read yet (`readableEnded` / `readableDidRead`); the WKC server path is unaffected since it builds the request before reading the body.

## 2.0.2

### Patch Changes

- 757ff09: harden two security-sensitive comparisons in shared library code (#105):
  - compare the `/metrics` bearer token in constant time (sha-256 digest + `timingSafeEqual`) in `@dcl/uws-http-server` and `@dcl/http-server` instead of `!==`/`!=`, so the check no longer leaks timing or length information about the configured token. `@dcl/http-server` now also validates the `Bearer` authorization scheme (rejecting `Basic <token>` etc.) for parity with `@dcl/uws-http-server`.
  - in `@dcl/memory-cache-component` `keys(pattern)`, escape regex metacharacters before turning `*` globs into `.*` and anchor the result with `^`/`# @dcl/http-server. this stops a caller-supplied pattern from injecting regex syntax (ReDoS) and makes the match whole-key rather than substring. patterns that relied on the previous unanchored substring matching will need an explicit leading/trailing `\*`.

- Updated dependencies [fcf5367]
  - @dcl/core-commons@0.10.1

## 2.0.1

### Patch Changes

- e833fce: fix the HTTP metrics middleware: derive the request size from the `Content-Length` header instead of the non-standard `node-fetch` `Request.size` property. After the native-fetch migration that property is `undefined` on the native `Request`, which made `prom-client` throw `Value is not a valid number` and return a `500` on every instrumented request.
- e833fce: fix multiple `Set-Cookie` response headers being collapsed to the last one. The response writer set each header with `res.setHeader('set-cookie', value)`, which overwrites by header name, so only the final cookie survived. Set-Cookie values are now emitted as an array (one `Set-Cookie` header per cookie).

## 2.0.0

### Major Changes

- f8b96d7: remove the `node-fetch` runtime dependency from `@dcl/http-server` by moving its request/response pipeline onto the native Node `fetch` API.

  `@dcl/core-commons` now exports an `IHttpServerComponent` whose `IRequest`/`IResponse` are bound to the global (undici) `Request`/`Response` shipped with Node instead of `node-fetch`, and `@dcl/http-server` builds requests and responses with those native types. Internally the server normalizes a handler response into a plain transport object that keeps `Buffer`/Node-stream bodies and informational statuses such as `101` (WebSocket upgrade), rather than round-tripping through a `Response` — the native constructor cannot represent a streamed body or a 1xx status. `node-fetch` is now a dev-only dependency used by the test HTTP clients.

  BREAKING CHANGE: `IHttpServerComponent.IRequest` is now the native `Request`, so `request.body` is a web `ReadableStream` instead of a Node `Readable`. Consumers that piped the request body (e.g. `request.body.pipe(...)`) must adapt it with `Readable.fromWeb(request.body)`.

### Patch Changes

- Updated dependencies [f8b96d7]
  - @dcl/core-commons@0.10.0

## 1.0.1

### Patch Changes

- e1f0c13: Fix error handling on readable responses

## 1.0.0

### Major Changes

- 1cfcb7b: http server based on well-known-components
