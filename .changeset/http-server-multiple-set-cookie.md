---
"@dcl/http-server": patch
---

fix multiple `Set-Cookie` response headers being collapsed to the last one. The response writer set each header with `res.setHeader('set-cookie', value)`, which overwrites by header name, so only the final cookie survived. Set-Cookie values are now emitted as an array (one `Set-Cookie` header per cookie).
