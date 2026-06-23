---
"@dcl/http-server": patch
---

performance on the request hot path:

- parse the request URL once. `getRequestFromNodeMessage` no longer builds a `URL` only to immediately discard it (it now parses with the two-arg `URL` form and falls back to concatenation only on failure), and `contextFromRequest` reuses that parsed `URL` instead of re-parsing `request.url`.
- the CORS middleware returns the downstream response untouched when the request has no `Origin` header, skipping the per-response headers copy and object spread.
- the router appends matched layer middlewares in place instead of `Array.concat` per layer (O(L) instead of O(L²)).
