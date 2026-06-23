---
"@dcl/block-indexer": minor
---

performance: make the bounded block cache and its lookups cheaper.

- evict in O(1): the FIFO cache now tracks insertion order with an insertion-ordered `Set` instead of an array, so eviction no longer does an O(n) `Array.shift()` on every insert once the cache is full.
- resolve the blocks enclosing a timestamp in a single tree descent. a new `AvlTree.findEnclosingValues(key)` returns the enclosing nodes' values directly, replacing the previous `findEnclosingRange` + two `get` lookups (three descents per search) with one.
