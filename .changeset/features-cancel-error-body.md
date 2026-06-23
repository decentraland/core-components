---
"@dcl/features-component": patch
---

release the feature-flags response body on the error path. `requestFeatureFlags` threw on a non-ok response before consuming the body, leaving an unconsumed undici response that pins its socket and buffers its bytes until GC. The body is now released with `response.body?.cancel()` before throwing.
