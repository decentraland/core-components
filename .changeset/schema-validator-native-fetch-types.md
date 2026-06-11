---
"@dcl/schema-validator-component": major
---

source `IHttpServerComponent` from `@dcl/core-commons` instead of `@well-known-components/interfaces`, so the validation middleware's request handlers type against the native-fetch request/response types and pair with `@dcl/http-server` v2 without casts. Middleware behavior is unchanged — it only reads the `Content-Type` header and the cloned JSON body, both WHATWG-compatible.

BREAKING CHANGE: `withSchemaValidatorMiddleware`'s return type now uses `@dcl/core-commons`' `IHttpServerComponent`; pair this component with `@dcl/http-server` v2.
