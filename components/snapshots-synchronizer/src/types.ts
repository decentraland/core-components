import { IContentStorageComponent } from '@dcl/catalyst-storage'
import { IContentDownloaderComponent } from '@dcl/content-downloader-component'
import { SyncDeployment } from '@dcl/schemas'
import { IBaseComponent, IFetchComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { metricsDefinitions } from './metrics'

/**
 * @public
 */
export type Server = string

/**
 * @public
 */
export type TimeRange = {
  initTimestamp: number
  endTimestamp: number
}

/**
 * @public
 */
export type SnapshotMetadata = {
  hash: string
  timeRange: TimeRange
  numberOfEntities: number
  replacedSnapshotHashes?: string[]
  generationTimestamp: number
}

/**
 * @public
 */
export type DeployableEntity = SyncDeployment & {
  markAsDeployed?: () => Promise<void>
  snapshotHash?: string
}

/**
 * A component that handles deployments. `scheduleEntityDeployment` should be idempotent.
 * @public
 */
export type IDeployerComponent = {
  scheduleEntityDeployment(entity: DeployableEntity, contentServers: string[]): Promise<void>
  onIdle(): Promise<void>
  prepareForDeploymentsIn(timeRanges: TimeRange[]): Promise<void>
}

/**
 * @public
 */
export type ISnapshotStorageComponent = {
  has(snapshotHash: string): Promise<boolean>
}

/**
 * @public
 */
export type IProcessedSnapshotStorageComponent = {
  filterProcessedSnapshotsFrom(snapshotHashes: string[]): Promise<Set<string>>
  markSnapshotAsProcessed(snapshotHash: string): Promise<void>
}

/**
 * @public
 */
export type ReconnectionOptions = {
  reconnectTime: number
  /** 1.1 by default */
  reconnectRetryTimeExponent?: number
  /** defaults to one day */
  maxReconnectionTime?: number
}

/**
 * @public
 */
export type SnapshotStreamOptions = {
  fromTimestamp?: number
  requestRetryWaitTime: number
  requestMaxRetries: number
  tmpDownloadFolder: string
  /** Delete downloaded snapshot files after usage. Default: true */
  deleteSnapshotAfterUsage?: boolean
}

/**
 * @public
 */
export type PointerChangesStreamOptions = {
  fromTimestamp?: number
  // When pointerChangesWaitTime == 0, polling is disabled and the stream ends after the first iteration.
  pointerChangesWaitTime: number
  requestRetryWaitTime?: number
  requestMaxRetries?: number
}

/**
 * @public
 */
export type SynchronizerOptions = SnapshotStreamOptions &
  PointerChangesStreamOptions & {
    bootstrapReconnection: ReconnectionOptions
    syncingReconnection: ReconnectionOptions
  }

/**
 * @public
 */
export type SyncJob = {
  onInitialBootstrapFinished(cb: () => Promise<void>): Promise<void>
  onSyncFinished(): Promise<void>
}

/**
 * Dependencies required by the snapshots-synchronizer component.
 * @public
 */
export type SnapshotsSynchronizerComponents = {
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricsDefinitions>
  fetcher: IFetchComponent
  storage: IContentStorageComponent
  contentDownloader: IContentDownloaderComponent
  deployer: IDeployerComponent
  snapshotStorage: ISnapshotStorageComponent
  processedSnapshotStorage: IProcessedSnapshotStorageComponent
}

/**
 * Orchestrates synchronization of deployments from catalyst content servers.
 * @public
 */
export type ISnapshotsSynchronizerComponent = IBaseComponent & {
  /** Bootstraps the given servers from snapshots, then keeps syncing from pointer-changes. */
  syncWithServers(contentServers: Set<string>): Promise<SyncJob>
  /** Streams the deployments contained in a single snapshot (downloads + parses it). */
  streamFromSnapshot(
    options: SnapshotStreamOptions,
    snapshotHash: string,
    servers: Set<string>
  ): AsyncIterable<DeployableEntity & { snapshotHash: string; servers: string[] }>
  /** Streams the deployments from a server's pointer-changes endpoint (optionally polling). */
  streamFromPointerChanges(options: PointerChangesStreamOptions, contentServer: string): AsyncIterable<SyncDeployment>
}
