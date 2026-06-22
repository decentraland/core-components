# @dcl/uws-http-server

## 1.0.1

### Patch Changes

- 757ff09: harden two security-sensitive comparisons in shared library code (#105):
  - compare the `/metrics` bearer token in constant time (sha-256 digest + `timingSafeEqual`) in `@dcl/uws-http-server` and `@dcl/http-server` instead of `!==`/`!=`, so the check no longer leaks timing or length information about the configured token. `@dcl/http-server` now also validates the `Bearer` authorization scheme (rejecting `Basic <token>` etc.) for parity with `@dcl/uws-http-server`.
  - in `@dcl/memory-cache-component` `keys(pattern)`, escape regex metacharacters before turning `*` globs into `.*` and anchor the result with `^`/`# @dcl/uws-http-server. this stops a caller-supplied pattern from injecting regex syntax (ReDoS) and makes the match whole-key rather than substring. patterns that relied on the previous unanchored substring matching will need an explicit leading/trailing `\*`.

## 1.0.0

### Major Changes

- 199cda1: initial release of `@dcl/uws-http-server`, moved into core-components from `@well-known-components/uws-http-server`. it provides a uWebSockets.js based http server component with lifecycle management and prometheus metrics helpers, and bumps `uWebSockets.js` to v20.68.0.
