---
'@dcl/block-indexer': minor
---

Migrate `@dcl/block-indexer` into the `core-components` monorepo. Sources and tests were moved from the standalone `decentraland/block-indexer` repository with no behavioral changes; dependencies were aligned with the monorepo (TypeScript 5.8, `@well-known-components/interfaces` ^1.5.1, `lru-cache` ~11.2.2, Node >= 20).
