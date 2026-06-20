---
"@dcl/uws-http-server": patch
"@dcl/http-server": patch
"@dcl/memory-cache-component": patch
---

harden two security-sensitive comparisons in shared library code (#105):

- compare the `/metrics` bearer token in constant time (sha-256 digest + `timingSafeEqual`) in `@dcl/uws-http-server` and `@dcl/http-server` instead of `!==`/`!=`, so the check no longer leaks timing or length information about the configured token. `@dcl/http-server` now also validates the `Bearer` authorization scheme (rejecting `Basic <token>` etc.) for parity with `@dcl/uws-http-server`.
- in `@dcl/memory-cache-component` `keys(pattern)`, escape regex metacharacters before turning `*` globs into `.*` and anchor the result with `^`/`$`. this stops a caller-supplied pattern from injecting regex syntax (ReDoS) and makes the match whole-key rather than substring. patterns that relied on the previous unanchored substring matching will need an explicit leading/trailing `*`.
