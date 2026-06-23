---
"@dcl/analytics-component": patch
---

fix a memory leak when sending events. `_sendEvent` only read `response.ok`/`response.status` and never consumed the body, so every event left an unconsumed undici response whose socket stays checked out of the pool and whose bytes stay buffered until GC. Because events are POSTed (not retried by the fetch component) and `fireEvent` is fire-and-forget, nothing else ever drained them, so under sustained event volume connections and heap accumulated. The response body is now released with `response.body?.cancel()` immediately after the request.
