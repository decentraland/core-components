---
"@dcl/fetch-component": minor
---

retry idempotent requests on network-level failures, not just on retryable status codes. a rejected `fetch` (dns resolution, connection refused/reset, socket hang up — including a severed keep-alive connection reused from undici's pool) previously escaped the retry loop and failed on the first attempt regardless of `attempts`. it is now caught and retried like a retryable status code for idempotent methods, re-throwing the last network error once the retries are exhausted. timeout/abort semantics are unchanged and non-idempotent methods are still never retried.
