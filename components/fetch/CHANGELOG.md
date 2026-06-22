# @dcl/fetch-component

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
