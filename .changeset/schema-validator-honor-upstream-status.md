---
"@dcl/schema-validator-component": patch
---

`withSchemaValidatorMiddleware`: when the request body read fails with an error that already carries an HTTP `status`/`statusCode` — for example a `413` raised by an upstream `@dcl/http-server` body-size limiter on a chunked body — surface that status instead of masking it as a generic `400`. Errors without a status (genuine JSON parse failures) still return `400`.
