---
'@dcl/test-helpers': minor
---

Drop the `@dcl/crypto-middleware` dependency and read the three signed-fetch header names from `@dcl/crypto` instead, raising the `@dcl/crypto` range to `^3.7.0` (the version that first exports them). This package only ever imported `AUTH_CHAIN_HEADER_PREFIX`, `AUTH_TIMESTAMP_HEADER` and `AUTH_METADATA_HEADER` from the middleware and never called `verify`, and the middleware marks its own re-exports of those constants `@deprecated Import from '@dcl/crypto' directly`. Consumers that hold their own direct `@dcl/crypto-middleware` dependency no longer get a second, unrelated major of it installed nested under this package. No behaviour or public API change.
