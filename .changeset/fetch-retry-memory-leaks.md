---
"@dcl/fetch-component": patch
---

harden and streamline the retry/timeout loop:

- cancel a retryable response's body before retrying. an unconsumed undici response body pins its socket and buffers the received bytes until GC, so retrying on a non-`ok` status (e.g. an upstream returning 5xx) leaked a connection and heap on every attempt. the body is now cancelled (`response.body?.cancel()`) before the next attempt; the final attempt's response is still returned to the caller untouched.
- drop the per-attempt `Promise.race` against a synthetic timeout `Response` and its `abort` event listener. the timeout timer aborts the request's signal and the fetch rejects on its own, which the existing catch + post-loop `aborted` check already turn into the `Request aborted (timed out)` error (the synthetic 408 was always discarded). this removes a `Promise`, a closure, an event listener and a `Response` allocation per attempt, and eliminates the unbounded `abort`-listener accumulation that occurred when a single `AbortController` was reused across requests. timeout/abort behavior and retry semantics are unchanged.
- minor allocation cleanups: status/method allow-lists are now `Set`s and the per-call option object is built with fewer spreads.
