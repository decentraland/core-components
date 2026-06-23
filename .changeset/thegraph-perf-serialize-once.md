---
"@dcl/thegraph-component": patch
---

performance: serialize the GraphQL request body once per query instead of re-running `JSON.stringify` on every retry attempt, and build the per-attempt query id / log context lazily inside the error path so successful queries skip the `randomUUID()` draw and object allocation.
