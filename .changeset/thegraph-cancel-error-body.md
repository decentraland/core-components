---
"@dcl/thegraph-component": patch
---

fix a memory leak on the subgraph error path. `postQuery` threw on a non-ok response without consuming the body; since `attemptQuery` retries (up to `SUBGRAPH_COMPONENT_RETRIES`, default 3), a subgraph returning 4xx/5xx leaked up to one undici connection + buffered body per attempt — an unconsumed native-fetch body keeps its socket checked out of the pool and its bytes on the heap until GC. The body is now released with `response.body?.cancel()` before throwing.
