---
"@dcl/http-requests-logger-component": major
---

initial release of `@dcl/http-requests-logger-component`, moved into core-components from `@well-known-components/http-requests-logger-component`. logs each http request and response with configurable verbosity, custom log formats, and endpoint skipping. the `server` argument is typed against `@dcl/core-commons`' `IHttpServerComponent`, so it pairs with `@dcl/http-server` v2 without a cast.
