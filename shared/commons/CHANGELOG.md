# @dcl/core-commons

## 0.11.0

### Minor Changes

- 6871695: Add `increment(key, { amount, ttlInSeconds })` to `ICacheStorageComponent`: an atomic counter that returns the post-increment `value` and the counter's `ttlRemainingInMilliseconds`. The TTL is applied only when the counter is created, or when an existing counter has no expiry at all, so a fixed window never slides. The Redis implementation runs the whole operation as a single Lua script (`INCRBY` + `PTTL` + conditional `PEXPIRE`); the in-memory implementation performs the read-modify-write in one synchronous block and uses lru-cache's `noUpdateTTL` to anchor the expiry to creation. A non-positive `ttlInSeconds` is rejected in both, since `PEXPIRE key 0` deletes the key in Redis while lru-cache reads a per-call `ttl: 0` as "never expire".

  This is what makes counting workloads (rate limiting, quotas) correct on a shared store: `get` + `set` loses updates across a network round trip, and `acquireLock` costs several extra round trips per call.

  Redis invokes its Lua scripts (`increment` and `releaseLock`) with `EVALSHA` rather than `EVAL`, so a per-request workload sends a 40-byte digest instead of re-uploading the script body every call. A `NOSCRIPT` reply falls back to sending the body, which keeps it correct across a restart, failover or `SCRIPT FLUSH` as well as on a cold cache.

  Per-operation logging in `@dcl/redis-component` moved to **debug** level. Every operation rethrows what it caught, so the caller owns the severity and the context; logging at error here as well double-reported the same failure.

  Startup keeps a louder voice, because it has no caller to report to: `start()` logs at error when the connection rejects, and the client's `error` event logs at warn the first time it fires before any successful connection. `connect()` does not reject on an unreachable server — it retries — so `start()` stays pending and its own catch never runs; without that line a service booting against a dead Redis hangs silently. It is emitted once rather than per retry, and the URL is redacted, since a Redis URL carries its password in the userinfo.

  ## Note for anyone mocking the interface

  This is an additive minor. Consuming code that _calls_ `ICacheStorageComponent` needs no change.

  The one place it is felt is a test double that reimplements the entire interface — `jest.Mocked<ICacheStorageComponent>` and hand-written object literals — which is tighter coupling to the interface shape than a consumer actually needs. Those see `TS2741` whenever they next widen their range, and the fix is one line:

  ```ts
  increment: jest.fn().mockResolvedValue({ value: 1 })
  ```

  Nothing moves on its own: every known consumer depends on `^0.10.1`, and a caret range on a `0.x` version locks the minor, so a repo picks this up only when it deliberately bumps.

  ## Two behaviours worth knowing
  - In-memory counters are subject to LRU eviction and can reset before their TTL expires (`max` defaults to 10 000), where Redis counters cannot.
  - The Redis backend lowercases keys in its string and counter operations while the in-memory backend does not, so normalize keys yourself when case-stability matters. Both are documented on the interface and in the two READMEs.

- 6871695: Expose the connected peer address to middleware as `context.remoteAddress`. `@dcl/http-server` captures `socket.remoteAddress` synchronously while building each request — so the value survives a socket torn down before the handler runs — normalizes IPv4-mapped IPv6 (`::ffff:127.0.0.1` becomes `127.0.0.1`), and carries it onto the context, where it is unaffected by middleware that replace `context.request` (as `createBodySizeLimitMiddleware` does). `IHttpServerComponent.DefaultContext` gains an optional `remoteAddress` field, so other server implementations can populate it too.

  Also exports `getRemoteAddress`, `setRemoteAddress` and `normalizeRemoteAddress`, and `createTestServerComponent` now accepts `{ remoteAddress }` so tests can supply a fake peer address (a per-request address set with `setRemoteAddress` takes precedence).

  This is the socket address, not a client address derived from `X-Forwarded-For`. Behind a proxy it is the proxy's address and is identical for every client; read a trusted forwarding header first and fall back to this only when the server is directly exposed.

## 0.10.1

### Patch Changes

- fcf5367: stop the published mock declarations from referencing the global `jest` namespace (#fix). `createFetchMockedComponent` and `createLoggerMockedComponent` are now typed against the plain `IFetchComponent` / `ILoggerComponent` interfaces (matching `createConfigMockedComponent`) instead of `jest.Mocked<...>`, while still returning `jest.fn()`-backed mocks at runtime. As a result `dist/mocks/fetch.d.ts` and `dist/mocks/logs.d.ts` no longer reference `jest`, so consumers that import `@dcl/core-commons` no longer need `@types/jest` (or `skipLibCheck`) just to type-check.

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
