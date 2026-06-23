# @dcl/fetch-component

## 1.1.1

### Patch Changes

- f416044: harden and streamline the retry/timeout loop:
  - cancel a retryable response's body before retrying. an unconsumed undici response body pins its socket and buffers the received bytes until GC, so retrying on a non-`ok` status (e.g. an upstream returning 5xx) leaked a connection and heap on every attempt. the body is now cancelled (`response.body?.cancel()`) before the next attempt; the final attempt's response is still returned to the caller untouched.
  - drop the per-attempt `Promise.race` against a synthetic timeout `Response` and its `abort` event listener. the timeout timer aborts the request's signal and the fetch rejects on its own, which the existing catch + post-loop `aborted` check already turn into the `Request aborted (timed out)` error (the synthetic 408 was always discarded). this removes a `Promise`, a closure, an event listener and a `Response` allocation per attempt, and eliminates the unbounded `abort`-listener accumulation that occurred when a single `AbortController` was reused across requests. timeout/abort behavior and retry semantics are unchanged.
  - minor allocation cleanups: status/method allow-lists are now `Set`s and the per-call option object is built with fewer spreads.

## 1.1.0

### Minor Changes

- 379e8f1: retry idempotent requests on network-level failures, not just on retryable status codes. a rejected `fetch` (dns resolution, connection refused/reset, socket hang up — including a severed keep-alive connection reused from undici's pool) previously escaped the retry loop and failed on the first attempt regardless of `attempts`. it is now caught and retried like a retryable status code for idempotent methods, re-throwing the last network error once the retries are exhausted. timeout/abort semantics are unchanged and non-idempotent methods are still never retried.

### Patch Changes

- Updated dependencies [fcf5367]
  - @dcl/core-commons@0.10.1

## 1.0.1

### Patch Changes

- Updated dependencies [f8b96d7]
  - @dcl/core-commons@0.10.0

## 1.0.0

### Major Changes

- ecae771: initial release of `@dcl/fetch-component`, moved into core-components from `@well-known-components/fetch-component`. it now uses the default node `fetch` api instead of `cross-fetch` (dropping the browser `buffer` polyfill) and types the component through the shared `IFetchComponent` from `@dcl/core-commons`.

### Patch Changes

- Updated dependencies [ecae771]
  - @dcl/core-commons@0.9.0
