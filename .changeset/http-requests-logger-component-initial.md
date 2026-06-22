---
"@dcl/http-requests-logger-component": major
---

initial release of `@dcl/http-requests-logger-component`, moved into core-components from `@well-known-components/http-requests-logger-component`. logs each http request and response with configurable verbosity, custom log formats, and endpoint skipping. the `server` argument is typed against `@dcl/core-commons`' `IHttpServerComponent`, so it pairs with `@dcl/http-server` v2 without a cast.

an error that escapes the handler chain without a `status` / `statusCode` is now logged as `500` instead of `200`.
