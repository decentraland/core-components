---
"@dcl/thegraph-component": minor
---

Add `@dcl/thegraph-component`: queries thegraph.com subgraphs over HTTP with per-query retries, an incremental timeout per attempt and `AbortController`-based cancellation (`createSubgraphComponent`). Migrated from `@well-known-components/thegraph-component` and switched to the native-fetch `IFetchComponent` from `@dcl/core-commons` (drops `node-fetch`). Exposes `metricDeclarations` for the request counter, error counter and query-duration histogram.
