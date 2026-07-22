---
'@dcl/http-server': minor
---

Abort each HTTP and upgrade handler's Fetch `Request.signal` when its client disconnects, and avoid logging or writing an error response after the HTTP connection is already gone.
