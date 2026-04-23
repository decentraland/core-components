import { AvlTree } from './avl-tree/types'
import { ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { metricsDefinitions } from './metrics'

/**
 * @public
 */
export type BlockInfo = {
  block: number
  timestamp: number
}

/**
 * @public
 */
export type BlockSearch = {
  tree: AvlTree<number, BlockInfo>
  findBlockForTimestamp(ts: number): Promise<BlockInfo | undefined>
}

/**
 * @public
 */
export type BlockRepository = {
  findBlock(block: number): Promise<BlockInfo>
  currentBlock(): Promise<BlockInfo>
}

/**
 * @public
 */
export type EthereumProvider = {
  getBlockNumber(): Promise<number>
  getBlock(block: number): Promise<{ timestamp: string | number }>
}

/**
 * @public
 */
export type BlockSearchComponents = {
  metrics: IMetricsComponent<keyof typeof metricsDefinitions>
  logs: ILoggerComponent
  blockRepository: BlockRepository
}

/**
 * @public
 */
export type BlockRepositoryComponents = {
  metrics: IMetricsComponent<keyof typeof metricsDefinitions>
  logs: ILoggerComponent
  ethereumProvider: EthereumProvider
}
