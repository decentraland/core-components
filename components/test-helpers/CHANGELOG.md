# @dcl/test-helpers

## 0.2.0

### Minor Changes

- 423e31e: add `@dcl/test-helpers`: jest test helpers for component-based programs, migrated from `@well-known-components/test-helpers`. exposes `createRunner` (a lifecycle-aware jest runner with `components`, `stubComponents`, `spyComponents` and `beforeStart`) and `createLocalFetchComponent` / `defaultServerConfig` for integration tests. the local fetch supports optional authenticated requests built in: pass an `identity` to sign the request with the signed-fetch pattern (ADR-44); `getIdentity`, `getAuthHeaders` and `getSignedAuthHeaders` are exported too. adapted to the core-components standards: jest-only (sinon removed — `stubComponents` now expose `jest.SpyInstance` mocks instead of sinon stubs) and the native global `fetch` (node-fetch removed).

### Patch Changes

- Updated dependencies [fcf5367]
  - @dcl/core-commons@0.10.1
