# @dcl/http-server

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
