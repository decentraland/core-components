---
"@dcl/http-server": patch
---

`getRequestFromNodeMessage`: don't attach an already-consumed request stream as the native `Request` body. When an upstream consumer (e.g. an Express `body-parser`) has already read the incoming message, wrapping the drained stream made the native `Request` constructor throw `Response body object should not be disturbed or locked`. The body is now only streamed when the incoming stream hasn't been read yet (`readableEnded` / `readableDidRead`); the WKC server path is unaffected since it builds the request before reading the body.
