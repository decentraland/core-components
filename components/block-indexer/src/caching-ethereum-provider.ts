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
      if (found) {
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
    if (found) {
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
