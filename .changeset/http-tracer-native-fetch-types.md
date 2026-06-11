---
"@dcl/http-tracer-component": major
---

source `IHttpServerComponent` from `@dcl/core-commons` instead of `@well-known-components/interfaces`, so the tracer accepts an `@dcl/http-server` v2 server (native-fetch request/response types) without a cast. The middleware behavior is unchanged — it only reads the request's headers/method/url, which are WHATWG-compatible.

BREAKING CHANGE: the `server` argument is now typed against `@dcl/core-commons`' `IHttpServerComponent`; pair this component with `@dcl/http-server` v2.
