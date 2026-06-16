import { PointerChangesStreamOptions, SnapshotStreamOptions } from '../types'
import { processDeploymentsInFile } from './file-processor'
import { fetchPointerChanges } from './remote-entity-client'
import { InternalComponents } from './types'
import { sleep } from './utils'

/**
 * Downloads a snapshot file (via the content-downloader), parses it line by line and yields the
 * deployments newer than `fromTimestamp`. The snapshot file is deleted from storage after usage.
 */
export async function* getDeployedEntitiesStreamFromSnapshot(
  components: Pick<InternalComponents, 'logs' | 'storage' | 'metrics' | 'contentDownloader'>,
  options: SnapshotStreamOptions,
  snapshotHash: string,
  servers: Set<string>
) {
  const genesisTimestamp = options.fromTimestamp || 0
  const logs = components.logs.getLogger('getDeployedEntitiesStreamFromSnapshot')
  logs.info('Snapshot to be processed.', { hash: snapshotHash, contentServers: JSON.stringify(Array.from(servers)) })
  try {
    // 1. download the snapshot file if needed
    await components.contentDownloader.downloadFileWithRetries(
      snapshotHash,
      options.tmpDownloadFolder,
      Array.from(servers),
      options.requestMaxRetries,
      options.requestRetryWaitTime
    )

    // 2. open the snapshot file and process line by line
    const deploymentsInFile = processDeploymentsInFile(snapshotHash, components, logs)
    for await (const deployment of deploymentsInFile) {
      if (deployment.entityTimestamp >= genesisTimestamp) {
        components.metrics.increment('dcl_entities_deployments_streamed_total', { source: 'snapshots' })
        yield {
          ...deployment,
          snapshotHash,
          servers: Array.from(servers)
        }
      }
    }
  } finally {
    if (options.deleteSnapshotAfterUsage !== false) {
      try {
        await components.storage.delete([snapshotHash])
      } catch (err: any) {
        logs.error(err)
      }
    }
  }
}

/**
 * Streams deployments from a server's pointer-changes endpoint, optionally polling forever
 * (when `pointerChangesWaitTime > 0`).
 */
export async function* getDeployedEntitiesStreamFromPointerChanges(
  components: Pick<InternalComponents, 'logs' | 'fetcher' | 'metrics'>,
  options: PointerChangesStreamOptions,
  contentServer: string
) {
  const logs = components.logs.getLogger(`pointerChangesStream(${contentServer})`)
  const genesisTimestamp = options.fromTimestamp || 0
  let greatestLocalTimestampProcessed = genesisTimestamp
  // `from` is inclusive, so each poll re-returns the deployments at the high-water timestamp. Track
  // the entityIds already yielded at that timestamp to skip those re-yields (never a distinct one).
  let entityIdsYieldedAtGreatestTimestamp = new Set<string>()
  logs.debug('Starting to stream entities from Pointer-Changes.', {
    contentServer,
    timestamp: new Date(genesisTimestamp).toISOString()
  })
  do {
    const pointerChanges = fetchPointerChanges(components, contentServer, greatestLocalTimestampProcessed, logs)
    for await (const deployment of pointerChanges) {
      const localTimestamp = deployment.localTimestamp

      // when we move past the previous high-water timestamp, reset the per-timestamp dedup set
      if (localTimestamp > greatestLocalTimestampProcessed) {
        greatestLocalTimestampProcessed = localTimestamp
        entityIdsYieldedAtGreatestTimestamp = new Set<string>()
      }

      const alreadyYielded =
        localTimestamp === greatestLocalTimestampProcessed &&
        entityIdsYieldedAtGreatestTimestamp.has(deployment.entityId)

      // selectively ignore deployments by localTimestamp, and skip ones already yielded this run
      if (localTimestamp >= genesisTimestamp && !alreadyYielded) {
        components.metrics.increment('dcl_entities_deployments_streamed_total', { source: 'pointer-changes' })
        yield deployment
        if (localTimestamp === greatestLocalTimestampProcessed) {
          entityIdsYieldedAtGreatestTimestamp.add(deployment.entityId)
        }
      }
    }

    await sleep(options.pointerChangesWaitTime)
  } while (options.pointerChangesWaitTime > 0)
}
