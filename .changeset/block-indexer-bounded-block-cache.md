---
"@dcl/block-indexer": patch
---

fix an unbounded memory leak in the AVL block-search cache. `createAvlBlockSearch` inserted a node for every distinct block ever probed and never removed any — no cap, no eviction — so a long-running indexer following an advancing chain head grew the tree without bound until the process was OOM-killed. The tree is now bounded by `maxCachedBlocks` (default 10,000, mirroring the caching ethereum provider) with FIFO eviction of the oldest cached blocks; an evicted block is simply refetched on a later lookup, so correctness is unchanged. The maximum can be overridden via the new optional `options.maxCachedBlocks` argument to `createAvlBlockSearch`.
