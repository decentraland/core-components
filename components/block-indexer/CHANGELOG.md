# @dcl/block-indexer

## 1.3.0

### Minor Changes

- f416044: performance: make the bounded block cache and its lookups cheaper.
  - evict in O(1): the FIFO cache now tracks insertion order with an insertion-ordered `Set` instead of an array, so eviction no longer does an O(n) `Array.shift()` on every insert once the cache is full.
  - resolve the blocks enclosing a timestamp in a single tree descent. a new `AvlTree.findEnclosingValues(key)` returns the enclosing nodes' values directly, replacing the previous `findEnclosingRange` + two `get` lookups (three descents per search) with one.

### Patch Changes

- f416044: fix an unbounded memory leak in the AVL block-search cache. `createAvlBlockSearch` inserted a node for every distinct block ever probed and never removed any — no cap, no eviction — so a long-running indexer following an advancing chain head grew the tree without bound until the process was OOM-killed. The tree is now bounded by `maxCachedBlocks` (default 10,000, mirroring the caching ethereum provider) with FIFO eviction of the oldest cached blocks; an evicted block is simply refetched on a later lookup, so correctness is unchanged. The maximum can be overridden via the new optional `options.maxCachedBlocks` argument to `createAvlBlockSearch`.

## 1.2.0

### Minor Changes

- d37a937: Migrate `@dcl/block-indexer` into the `core-components` monorepo. Sources and tests were moved from the standalone `decentraland/block-indexer` repository with dependencies aligned with the monorepo (TypeScript 5.8, `@well-known-components/interfaces` ^1.5.1, `lru-cache` ~11.2.2, Node >= 20).

  Behavior changes landed during the migration:
  - `BlockRepository.findBlock` and `caching-ethereum-provider`'s cache now accept a genuine `0` timestamp as valid instead of treating it as "not retrievable" (switched from a falsy check to `!= null`). This matters for genesis-era blocks and defensive correctness.
  - `BlockRepository.currentBlock` no longer re-logs errors that originate inside `findBlock`. Previously every `findBlock` failure surfaced two identical `logger.error` entries because both methods had their own catch/log/rethrow wrapper.
  - `BlockSearch` no longer exposes the internal AVL tree through `.tree`. The tree is an implementation detail and leaking it forced callers to depend on the AVL internals.
  - `loadTree` / `saveTree` now attach `'error'` handlers to the underlying file streams and reject the returned promise on stream failures, instead of letting them surface as uncaught errors that would crash the Node process.
  - `saveTree` no longer wraps the converter result in an extra array; the previous `[converter(...)].join(',')` happened to produce the right output by relying on `Array.prototype.toString` coercion of the inner array.
