# @dcl/http-server

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
