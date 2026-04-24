import { BlockInfo, BlockRepository, BlockRepositoryComponents } from './types'

/**
 * @public
 */
export const createBlockRepository = ({
  ethereumProvider,
  logs,
  metrics
}: BlockRepositoryComponents): BlockRepository => {
  const logger = logs.getLogger('block-repository')

  async function findBlock(block: number): Promise<BlockInfo> {
    const tsStart = Date.now()
    try {
      const { timestamp } = await ethereumProvider.getBlock(block)
      metrics.increment('block_indexer_rpc_requests')

      // `timestamp` is `string | number`; `!= null` accepts a legitimate
      // genesis-era `0` while still rejecting `undefined`/`null` that
      // indicate a missing field.
      if (timestamp != null) {
        return {
          block,
          timestamp: Number(timestamp)
        }
      }
      throw Error(`Block ${block} could not be retrieved.`)
    } catch (e: any) {
      logger.error(e)
      throw e
    } finally {
      metrics.observe('block_indexer_find_block_duration_ms', {}, Date.now() - tsStart)
    }
  }

  async function currentBlock(): Promise<BlockInfo> {
    // `findBlock` already logs + rethrows on its own path; letting the
    // `getBlockNumber` error propagate unlogged here avoids the double
    // `logger.error` the previous implementation produced when
    // `findBlock` failed.
    const block = await ethereumProvider.getBlockNumber()
    metrics.increment('block_indexer_rpc_requests')
    return findBlock(block)
  }

  return {
    currentBlock,
    findBlock
  }
}
