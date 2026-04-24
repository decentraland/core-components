---
'@dcl/block-indexer': minor
---

Migrate `@dcl/block-indexer` into the `core-components` monorepo. Sources and tests were moved from the standalone `decentraland/block-indexer` repository with dependencies aligned with the monorepo (TypeScript 5.8, `@well-known-components/interfaces` ^1.5.1, `lru-cache` ~11.2.2, Node >= 20).

Behavior changes landed during the migration:

- `BlockRepository.findBlock` and `caching-ethereum-provider`'s cache now accept a genuine `0` timestamp as valid instead of treating it as "not retrievable" (switched from a falsy check to `!= null`). This matters for genesis-era blocks and defensive correctness.
- `BlockRepository.currentBlock` no longer re-logs errors that originate inside `findBlock`. Previously every `findBlock` failure surfaced two identical `logger.error` entries because both methods had their own catch/log/rethrow wrapper.
- `BlockSearch` no longer exposes the internal AVL tree through `.tree`. The tree is an implementation detail and leaking it forced callers to depend on the AVL internals.
- `loadTree` / `saveTree` now attach `'error'` handlers to the underlying file streams and reject the returned promise on stream failures, instead of letting them surface as uncaught errors that would crash the Node process.
- `saveTree` no longer wraps the converter result in an extra array; the previous `[converter(...)].join(',')` happened to produce the right output by relying on `Array.prototype.toString` coercion of the inner array.
