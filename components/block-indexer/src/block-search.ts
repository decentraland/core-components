import { BlockInfo, BlockSearch, BlockSearchComponents } from './types'
import { createAvlTree } from './avl-tree/avl-tree'

/**
 * @public
 */
export const createAvlBlockSearch = ({ metrics, logs, blockRepository }: BlockSearchComponents): BlockSearch => {
  const logger = logs.getLogger('block-search')
  const tree = createAvlTree<number, BlockInfo>(
    (x, y) => x - y,
    // TODO Need to check if it is possible for 2 blocks to have the same timestamp (unlikely)
    (x, y) => x.block! - y.block!
  )

  async function retrieveBlockAndAddToTree(blockNumber: number) {
    // We first attempt to search in the tree
    const found = tree.findByValue({ block: blockNumber })
    if (found) {
      return found
    }

    // Only if not found we go to the blockchain and cache it for later
    const blockInfo = await blockRepository.findBlock(blockNumber)
    if (blockInfo) {
      tree.insert(blockInfo.timestamp, blockInfo)
    }
    return blockInfo
  }

  async function findBlockForTimestamp(ts: number): Promise<BlockInfo | undefined> {
    const tsStart = Date.now()

    const range = tree.findEnclosingRange(ts)

    function getStartRange(): number {
      let start = 1
      if (range.min !== undefined) {
        const entry = tree.get(range.min)
        if (entry) {
          start = entry.block
        }
      }
      return start
    }

    async function getEndRange(): Promise<number> {
      let end: number | undefined
      if (range.max !== undefined) {
        const entry = tree.get(range.max)
        if (entry) {
          end = entry.block
        }
      }

      if (end === undefined) {
        end = (await blockRepository.currentBlock()).block
      }

      return end
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
    tree,
    findBlockForTimestamp
  }
}
