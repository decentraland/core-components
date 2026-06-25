---
"@dcl/http-server": minor
---

Add `createBodySizeLimitMiddleware(bytes)`: a per-route middleware that rejects request bodies larger than the given size with `413 Payload Too Large`. A request declaring a larger `Content-Length` is rejected up front; a body that omits or under-declares its length (e.g. chunked transfer-encoding) is capped while streaming (the body read by downstream handlers errors with a `413` once the limit is crossed). Either way the `413` sets `Connection: close`, so an oversized or stalled request can't tie up the socket. Unlike the server-wide `maxBodySize` option, it can be applied to individual routes for tighter, per-endpoint limits, and composes with the global cap. The size must be a positive integer or the factory throws.
