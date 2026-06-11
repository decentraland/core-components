---
"@dcl/http-server": patch
---

fix the HTTP metrics middleware: derive the request size from the `Content-Length` header instead of the non-standard `node-fetch` `Request.size` property. After the native-fetch migration that property is `undefined` on the native `Request`, which made `prom-client` throw `Value is not a valid number` and return a `500` on every instrumented request.
