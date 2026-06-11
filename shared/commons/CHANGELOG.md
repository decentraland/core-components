# @dcl/core-commons

## 0.10.0

### Minor Changes

- f8b96d7: remove the `node-fetch` runtime dependency from `@dcl/http-server` by moving its request/response pipeline onto the native Node `fetch` API.

  `@dcl/core-commons` now exports an `IHttpServerComponent` whose `IRequest`/`IResponse` are bound to the global (undici) `Request`/`Response` shipped with Node instead of `node-fetch`, and `@dcl/http-server` builds requests and responses with those native types. Internally the server normalizes a handler response into a plain transport object that keeps `Buffer`/Node-stream bodies and informational statuses such as `101` (WebSocket upgrade), rather than round-tripping through a `Response` — the native constructor cannot represent a streamed body or a 1xx status. `node-fetch` is now a dev-only dependency used by the test HTTP clients.

  BREAKING CHANGE: `IHttpServerComponent.IRequest` is now the native `Request`, so `request.body` is a web `ReadableStream` instead of a Node `Readable`. Consumers that piped the request body (e.g. `request.body.pipe(...)`) must adapt it with `Readable.fromWeb(request.body)`.

## 0.9.0

### Minor Changes

- ecae771: add the shared `IFetchComponent` and `RequestOptions` types, backed by the default node `fetch` api, so server components share a single fetch type instead of importing it from `@well-known-components/interfaces`.

## 0.8.0

### Minor Changes

- f79563a: Add `exists(key)` to `ICacheStorageComponent` and implement it in both Redis and in-memory components.

  `exists` is a presence-only check that avoids transferring the cached value over the wire — useful for set-style caches where callers only care whether they've seen a key before (e.g. a "have we already confirmed this asset exists upstream?" cache). The Redis implementation delegates to `EXISTS`; the in-memory implementation delegates to `LRUCache.has`, which respects expiry and does not bump the LRU recency.

## 0.7.0

### Minor Changes

- fcef9b9: Extend `IQueueComponent.sendMessage` with a `SendMessageOptions` bag and clean up two small issues on the way:

  - **`options.isRawMessage`** — controls the shape of the SQS `MessageBody`. Default is `false` (the SNS-envelope shape `{ Message: JSON.stringify(message) }`) to preserve the production-tested format existing consumers read. Set to `true` for the single `JSON.stringify(message)` shape that SNS produces with Raw Message Delivery enabled, and that `@dcl/queue-consumer-component` expects.
  - **`options.delaySeconds`** — forwarded to `SendMessageCommand.DelaySeconds` so callers can defer delivery per message. Replaces the previous hardcoded `DelaySeconds: 10`, which was unconditional and undocumented.
  - **`sendMessage` parameter type narrowed** from `any` to `unknown` on the shared interface and both implementations so callers keep type-checking across the boundary.
  - **`@dcl/memory-queue-component`** honors both options: a per-call `isRawMessage` wins over the component-level `wrapInSnsFormat` default (kept for backward compatibility), and `delaySeconds` shifts the message's `visibleAt`.
  - Dropped the redundant `config.getString?.(...)` optional chain in the SQS component (`getString` is always present on `IConfigComponent`).

## 0.6.0

### Minor Changes

- df22de3: Add IQueueComponent interface

## 0.5.1

### Patch Changes

- 4a6d070: Add the interfaces dependencies

## 0.5.0

### Minor Changes

- 839b790: Add the acquireLock, releaseLock, tryAcquireLock, and tryReleaseLock functions to the Redis and memory storage components.

## 0.4.0

### Minor Changes

- 31cc8ef: Adds the new hash functions

## 0.3.0

### Minor Changes

- 46ccace: Add ICacheStorageComponent interface

## 0.2.3

### Patch Changes

- 74e1fc1: Adds a README to all packages.

## 0.2.2

### Patch Changes

- ddcdb62: Fix package entrypoint

## 0.2.1

### Patch Changes

- fbca22e: Publish the core-commons package publicly and use it

## 0.2.0

### Minor Changes

- 396f7dc: Initial repository & packages setup
