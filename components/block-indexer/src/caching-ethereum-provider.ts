import { EthereumProvider } from './types'
import { LRUCache } from 'lru-cache'

/**
 * @public
 */
export const createCachingEthereumProvider = (eth: EthereumProvider): EthereumProvider => {
  const cache = new LRUCache<number, string | number>({
    max: 10000,
    fetchMethod: async (block: number): Promise<string | number> => {
      const found = await eth.getBlock(block)
      // Accept a legitimate genesis-era `0` timestamp while rejecting
      // missing/null fields that indicate a real "not retrievable" case.
      if (found && found.timestamp != null) {
        return found.timestamp
      }

      throw Error(`Block ${block} could not be retrieved.`)
    }
  })

  function getBlockNumber(): Promise<number> {
    return eth.getBlockNumber()
  }

  async function getBlock(block: number): Promise<{ timestamp: string | number }> {
    const found = await cache.fetch(block)
    // `found` is the cached timestamp value; `!= null` preserves `0`.
    if (found != null) {
      return {
        timestamp: found
      }
    }

    throw Error(`Block ${block} could not be retrieved.`)
  }

  return {
    getBlockNumber,
    getBlock
  }
}
