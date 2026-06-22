---
"@dcl/http-requests-logger-component": major
---

initial release of `@dcl/http-requests-logger-component`, moved into core-components from `@well-known-components/http-requests-logger-component`. logs each http request and response with configurable verbosity, custom log formats, and endpoint skipping. the `server` argument is typed against `@dcl/core-commons`' `IHttpServerComponent`, so it pairs with `@dcl/http-server` v2 without a cast.

includes fixes relative to the original component:

- an error that escapes the handler chain is now logged at error level with status `500` (it was logged at the configured verbosity with status `200`).
- `skip` regexes carrying the global/sticky flag now match consistently across requests (the reused regex's `lastIndex` previously made matches alternate).
- a custom `inputLog` callback is no longer invoked for requests whose input log is skipped.
