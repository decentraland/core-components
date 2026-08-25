# @dcl/test-helpers

## 0.3.2

### Patch Changes

- a7d9acf: Sign the metadata bytes verbatim in `getAuthHeaders`.

  The payload parts were each lowercased and then the whole joined string was lowercased again, which folded the serialized metadata after building it. That is the pre-6.0.0 ADR-44 format; `@dcl/crypto-middleware` 6 reconstructs `method:path:timestamp:metadata` with the metadata exactly as `x-identity-metadata` delivers it.

  For all-lowercase metadata the two forms are byte-identical, which is why every suite using this helper passed and the mismatch went unnoticed. It only showed up for metadata carrying uppercase, where the helper signed one thing and delivered another — so a service test could not exercise the current signing format at all, and a request that should have been refused by a metadata gate was refused by signature verification instead, for the wrong reason.

  Only the trailing fold is removed. The method and path are still lowercased, which is what the signed payload binds.

## 0.3.1

### Patch Changes

- Updated dependencies [6871695]
- Updated dependencies [6871695]
  - @dcl/core-commons@0.11.0

## 0.3.0

### Minor Changes

- c90e736: Drop the `@dcl/crypto-middleware` dependency and read the three signed-fetch header names from `@dcl/crypto` instead, raising the `@dcl/crypto` range to `^3.7.0` (the version that first exports them). This package only ever imported `AUTH_CHAIN_HEADER_PREFIX`, `AUTH_TIMESTAMP_HEADER` and `AUTH_METADATA_HEADER` from the middleware and never called `verify`, and the middleware marks its own re-exports of those constants `@deprecated Import from '@dcl/crypto' directly`. Consumers that hold their own direct `@dcl/crypto-middleware` dependency no longer get a second, unrelated major of it installed nested under this package. No behaviour or public API change.

## 0.2.0

### Minor Changes

- 423e31e: add `@dcl/test-helpers`: jest test helpers for component-based programs, migrated from `@well-known-components/test-helpers`. exposes `createRunner` (a lifecycle-aware jest runner with `components`, `stubComponents`, `spyComponents` and `beforeStart`) and `createLocalFetchComponent` / `defaultServerConfig` for integration tests. the local fetch supports optional authenticated requests built in: pass an `identity` to sign the request with the signed-fetch pattern (ADR-44); `getIdentity`, `getAuthHeaders` and `getSignedAuthHeaders` are exported too. adapted to the core-components standards: jest-only (sinon removed — `stubComponents` now expose `jest.SpyInstance` mocks instead of sinon stubs) and the native global `fetch` (node-fetch removed).

### Patch Changes

- Updated dependencies [fcf5367]
  - @dcl/core-commons@0.10.1
