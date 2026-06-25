---
"@dcl/schema-validator-component": minor
---

`createSchemaValidatorComponent`: add a `maxBodySize` option (bytes). When set, the validation middleware rejects a request that declares a larger `Content-Length` with `413 Payload Too Large` before parsing its body. The value is validated as a positive integer at construction. This is a declared-size guard; for bodies that omit or under-declare their length (e.g. chunked transfer-encoding), pair it with the `@dcl/http-server` `maxBodySize`, which caps the body at the transport layer while streaming.
