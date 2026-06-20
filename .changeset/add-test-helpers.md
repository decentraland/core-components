---
"@dcl/test-helpers": minor
---

add `@dcl/test-helpers`: jest test helpers for component-based programs, migrated from `@well-known-components/test-helpers`. exposes `createRunner` (a lifecycle-aware jest runner with `components`, `stubComponents`, `spyComponents` and `beforeStart`) and `createLocalFetchComponent` / `defaultServerConfig` for integration tests. adapted to the core-components standards: jest-only (sinon removed — `stubComponents` now expose `jest.SpyInstance` mocks instead of sinon stubs) and the native global `fetch` (node-fetch removed).
