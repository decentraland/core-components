---
'@dcl/http-server': minor
---

Abort each HTTP and upgrade handler's Fetch `Request.signal` when its client disconnects, including while an HTTP response is streaming or a pending WebSocket upgrade is half-closed, and avoid logging or writing an error response after the connection is already gone.
