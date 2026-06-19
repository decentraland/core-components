---
---

No release needed. Removes the lingering `node-fetch` / `@types/node-fetch` devDependencies from `@dcl/http-server`, `@dcl/metrics` and `@dcl/uws-http-server` and replaces the remaining `node-fetch` usage in their test harnesses with the native global `fetch` / `undici`. Dev-only and test-only; no source, dist, or runtime behavior change.
