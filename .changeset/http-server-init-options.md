---
"@dcl/http-server": minor
---

`createServerComponent`: add more initialization options. New `maxBodySize` caps incoming request bodies — requests declaring a larger `Content-Length` are rejected with `413 Payload Too Large` before the body is read, and bodies that omit or under-declare their length (e.g. chunked transfer-encoding) are capped with the same `413` while streaming. Also exposes the Node server tunables `requestTimeout`, `maxHeadersCount` and `maxRequestsPerSocket` (alongside the existing `keepAliveTimeout`/`headersTimeout`). Fixes a latent bug in `getServer` where providing `https` options was silently overwritten by the plain-http fallback, so `https` servers are now created as intended.
