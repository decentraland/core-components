---
"@dcl/http-server": minor
---

add `fromNativeResponse(response)` and harden native-`Response` handling.

A native `Response` (e.g. from `fetch`) is not assignable to the server's `IResponse` (its body is a web `ReadableStream`), yet it was handled at runtime — so one forced in via a cast would be silently corrupted by response-transforming middleware (the CORS middleware's `{ ...response }` drops a `Response`'s prototype-getter `status`/`body`, serving a bodiless `200`).

- `fromNativeResponse(response)`: adapts a native `Response` into the structural `IResponse` for returning from a handler (e.g. proxying an upstream `fetch`). The body is streamed via `Readable.fromWeb` (not buffered); stale `Content-Encoding`/`Content-Length`/`Transfer-Encoding` headers are dropped — the body has already been decoded and is re-streamed, so forwarding them would double-decode or truncate the response; a locked/already-consumed body is forwarded as no body rather than throwing.
- `normalizeResponseBody` routes native `Response`s through the same adapter, so the direct and proxied paths normalize identically.
- the CORS middleware converts a native `Response` before re-wrapping it (and returns it untouched when there is no `Origin`), so it can no longer drop status/body.
