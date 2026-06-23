import { BlockInfo, BlockSearch, BlockSearchComponents } from './types'
import { createAvlTree } from './avl-tree/avl-tree'

/**
 * Maximum number of blocks kept in the in-memory search tree. Without a cap the
 * tree gains a node for every distinct block ever probed and never releases one,
 * so a long-running indexer (continuously advancing chain head → ever-new
 * timestamps) grows it without bound until the process is OOM-killed. Mirrors the
 * bound used by the caching ethereum provider.
 */
const DEFAULT_MAX_CACHED_BLOCKS = 10_000

/**
 * @public
 */
export const createAvlBlockSearch = (
  { metrics, logs, blockRepository }: BlockSearchComponents,
  options: { maxCachedBlocks?: number } = {}
): BlockSearch => {
  const logger = logs.getLogger('block-search')
  // Require a positive integer; fall back to the default otherwise. An invalid cap
  // (NaN/Infinity/0/negative) would make the `size > maxCachedBlocks` check never
  // fire and silently reintroduce the unbounded-growth this bound exists to prevent.
  const maxCachedBlocks =
    Number.isInteger(options.maxCachedBlocks) && (options.maxCachedBlocks as number) > 0
      ? (options.maxCachedBlocks as number)
      : DEFAULT_MAX_CACHED_BLOCKS
  const tree = createAvlTree<number, BlockInfo>(
    (x, y) => x - y,
    // TODO Need to check if it is possible for 2 blocks to have the same timestamp (unlikely)
    (x, y) => x.block! - y.block!
  )
  // Timestamps in insertion order, used to evict the oldest cached block (FIFO)
  // once the tree reaches `maxCachedBlocks`. A Set preserves insertion order and
  // evicts the oldest key in O(1) (`values().next()` + `delete`); a plain array
  // with `shift()` would be O(n) per insert once the cache is full. Kept in sync
  // with the tree: a timestamp is recorded only when a brand-new node is inserted.
  const insertionOrder = new Set<number>()

  function addBlockToTree(blockInfo: BlockInfo) {
    // Skip timestamps already cached: the tree throws when the same key is
    // inserted with a different value, and a duplicate would also desync
    // `insertionOrder` from the tree's contents.
    if (tree.contains(blockInfo.timestamp)) {
      return
    }

    tree.insert(blockInfo.timestamp, blockInfo)
    insertionOrder.add(blockInfo.timestamp)

    // Evict oldest entries until back under the cap. A forward-advancing indexer
    // never revisits old blocks, so dropping the earliest-inserted ones only ever
    // costs an occasional refetch, never correctness.
    while (insertionOrder.size > maxCachedBlocks) {
      const oldestTimestamp = insertionOrder.values().next().value as number
      insertionOrder.delete(oldestTimestamp)
      tree.remove(oldestTimestamp)
    }
  }

  async function retrieveBlockAndAddToTree(blockNumber: number) {
    // We first attempt to search in the tree
    const found = tree.findByValue({ block: blockNumber })
    if (found) {
      return found
    }

    // Only if not found we go to the blockchain and cache it for later
    const blockInfo = await blockRepository.findBlock(blockNumber)
    if (blockInfo) {
      addBlockToTree(blockInfo)
    }
    return blockInfo
  }

  async function findBlockForTimestamp(ts: number): Promise<BlockInfo | undefined> {
    const tsStart = Date.now()

    // Resolve the blocks enclosing `ts` in a single tree descent: `findEnclosingValues`
    // returns the stored `BlockInfo`s directly, avoiding the two extra `get` lookups
    // the previous `findEnclosingRange` + `get(min)`/`get(max)` required.
    const range = tree.findEnclosingValues(ts)

    function getStartRange(): number {
      return range.min ? range.min.block : 1
    }

    async function getEndRange(): Promise<number> {
      if (range.max) {
        return range.max.block
      }
      return (await blockRepository.currentBlock()).block
    }

    try {
      const start = getStartRange()
      const end = await getEndRange()
      return await findBlockForTimestampInRange(ts, start, end)
    } catch (e: any) {
      logger.error(e)
      throw e
    } finally {
      const tsEnd = Date.now()
      metrics.observe('block_indexer_search_duration_ms', {}, tsEnd - tsStart)
    }
  }

  async function findBlockForTimestampInRange(
    ts: number,
    startBlock: number,
    endBlock: number
  ): Promise<BlockInfo | undefined> {
    while (startBlock <= endBlock) {
      const middle = Math.floor((startBlock + endBlock) / 2)
      const blockInMiddle = await retrieveBlockAndAddToTree(middle)

      if (blockInMiddle.timestamp === ts) {
        metrics.increment('block_indexer_hits')
        return blockInMiddle
      } else if (blockInMiddle.timestamp < ts) {
        if (middle + 1 > endBlock) {
          break
        }
        startBlock = middle + 1
      } else {
        endBlock = middle - 1
      }
    }

    metrics.increment('block_indexer_misses')
    const [blockAtStart, blockAtEnd] = await Promise.all([
      retrieveBlockAndAddToTree(startBlock),
      retrieveBlockAndAddToTree(endBlock)
    ])

    if (blockAtStart && blockAtStart.timestamp <= ts) {
      return blockAtStart
    } else if (blockAtEnd && blockAtEnd.timestamp <= ts) {
      return blockAtEnd
    }

    return undefined
  }

  return {
    findBlockForTimestamp
  }
}
