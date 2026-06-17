import { IContentStorageComponent } from '@dcl/catalyst-storage'
import { IBaseComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { metricsDefinitions } from './metrics'

/**
 * @public
 */
export type ContentMapping = { file: string; hash: string }

/**
 * Dependencies required by the content-downloader component.
 * @public
 */
export type ContentDownloaderComponents = {
  logs: ILoggerComponent
  storage: IContentStorageComponent
  metrics: IMetricsComponent<keyof typeof metricsDefinitions>
}

/**
 * Downloads content-addressed files from a set of content servers into the storage component.
 * @public
 */
export type IContentDownloaderComponent = IBaseComponent & {
  /**
   * Downloads a single content file (by hash) into storage, trying the given servers with retries.
   * Concurrent calls for the same hash+folder are de-duplicated.
   * @throws InvalidContentHashError when the hash is not a plain content address.
   */
  downloadFileWithRetries(
    hashToDownload: string,
    targetTempFolder: string,
    presentInServers: string[],
    maxRetries: number,
    waitTimeBetweenRetries: number
  ): Promise<void>

  /**
   * Downloads an entity file and all of its content (and, for profiles, avatar snapshots not in
   * `content`). Returns the parsed entity metadata.
   * @param contentFilesConcurrency - Max content files downloaded in parallel (default 10).
   * @throws EntityNotRetrievableError when the entity file is missing from storage after download.
   */
  downloadEntityAndContentFiles(
    entityId: string,
    presentInServers: string[],
    targetFolder: string,
    maxRetries: number,
    waitTimeBetweenRetries: number,
    contentFilesConcurrency?: number
  ): Promise<unknown>
}
