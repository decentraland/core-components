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
  async function currentBlock(): Promise<BlockInfo> {
    try {
      const block = await ethereumProvider.getBlockNumber()
      metrics.increment('block_indexer_rpc_requests')
      const found = await findBlock(block)
      if (!found) {
        throw Error(`Current block (${block}) could not be retrieved.`)
      }

      return found
    } catch (e: any) {
      logger.error(e)
      throw e
    }
  }

  async function findBlock(block: number): Promise<BlockInfo> {
    const tsStart = Date.now()
    try {
      const { timestamp } = await ethereumProvider.getBlock(block)
      metrics.increment('block_indexer_rpc_requests')

      if (timestamp) {
        return {
          block: block,
          timestamp: Number(timestamp)
        }
      }
    } catch (e: any) {
      logger.error(e)
      throw e
    } finally {
      const tsEnd = Date.now()
      metrics.observe('block_indexer_find_block_duration_ms', {}, tsEnd - tsStart)
    }

    throw Error(`Block ${block} could not be retrieved.`)
  }

  return {
    currentBlock,
    findBlock
  }
}
