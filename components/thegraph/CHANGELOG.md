# @dcl/thegraph-component

## 0.1.2

### Patch Changes

- f416044: fix a memory leak on the subgraph error path. `postQuery` threw on a non-ok response without consuming the body; since `attemptQuery` retries (up to `SUBGRAPH_COMPONENT_RETRIES`, default 3), a subgraph returning 4xx/5xx leaked up to one undici connection + buffered body per attempt — an unconsumed native-fetch body keeps its socket checked out of the pool and its bytes on the heap until GC. The body is now released with `response.body?.cancel()` before throwing.
- f416044: performance: serialize the GraphQL request body once per query instead of re-running `JSON.stringify` on every retry attempt, and build the per-attempt query id / log context lazily inside the error path so successful queries skip the `randomUUID()` draw and object allocation.

## 0.1.1

### Patch Changes

- Updated dependencies [fcf5367]
  - @dcl/core-commons@0.10.1

## 0.1.0

### Minor Changes

- 4b5f4e7: Add `@dcl/thegraph-component`: queries thegraph.com subgraphs over HTTP with per-query retries, an incremental timeout per attempt and `AbortController`-based cancellation (`createSubgraphComponent`). Migrated from `@well-known-components/thegraph-component` and switched to the native-fetch `IFetchComponent` from `@dcl/core-commons` (drops `node-fetch`). Query timeouts now raise a deterministic `SubgraphQueryTimeoutError` and are classified as `timeout` in `subgraph_errors_total` regardless of how the injected fetch component surfaces an aborted request. Exposes `metricDeclarations` for the request counter, error counter and query-duration histogram.
