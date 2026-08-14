---
'@dcl/core-commons': minor
'@dcl/http-server': minor
---

Expose the connected peer address to middleware as `context.remoteAddress`. `@dcl/http-server` captures `socket.remoteAddress` synchronously while building each request — so the value survives a socket torn down before the handler runs — normalizes IPv4-mapped IPv6 (`::ffff:127.0.0.1` becomes `127.0.0.1`), and carries it onto the context, where it is unaffected by middleware that replace `context.request` (as `createBodySizeLimitMiddleware` does). `IHttpServerComponent.DefaultContext` gains an optional `remoteAddress` field, so other server implementations can populate it too.

Also exports `getRemoteAddress`, `setRemoteAddress` and `normalizeRemoteAddress`, and `createTestServerComponent` now accepts `{ remoteAddress }` so tests can supply a fake peer address (a per-request address set with `setRemoteAddress` takes precedence).

This is the socket address, not a client address derived from `X-Forwarded-For`. Behind a proxy it is the proxy's address and is identical for every client; read a trusted forwarding header first and fall back to this only when the server is directly exposed.
