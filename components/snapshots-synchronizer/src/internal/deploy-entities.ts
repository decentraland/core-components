import { PointerChangesStreamOptions, SnapshotStreamOptions } from '../types'
import { getDeployedEntitiesStreamFromPointerChanges, getDeployedEntitiesStreamFromSnapshot } from './stream-entities'
import { InternalComponents } from './types'

/**
 * Streams and deploys the entities from a server's pointer-changes. Calls `increaseLastTimestamp`
 * for each entity once it's marked deployed.
 */
export async function deployEntitiesFromPointerChanges(
  components: Pick<InternalComponents, 'logs' | 'metrics' | 'fetcher' | 'deployer'>,
  options: PointerChangesStreamOptions,
  contentServer: string,
  shouldStopStream: () => boolean,
  increaseLastTimestamp: (contentServer: string, ...newTimestamps: number[]) => void
) {
  const logger = components.logs.getLogger('deployEntitiesFromPointerChanges')
  const deployments = getDeployedEntitiesStreamFromPointerChanges(components, options, contentServer)

  for await (const deployment of deployments) {
    if (shouldStopStream()) {
      logger.debug('Canceling running stream')
      return
    }

    await components.deployer.scheduleEntityDeployment(
      {
        ...deployment,
        markAsDeployed: async function () {
          components.metrics.increment('dcl_entities_deployments_processed_total', { source: 'pointer-changes' })
          increaseLastTimestamp(contentServer, deployment.localTimestamp)
        }
      },
      [contentServer]
    )
  }
}

/**
 * Streams and deploys the entities of a snapshot. When the deployer marks all entities as deployed,
 * the snapshot is saved as processed.
 */
export async function deployEntitiesFromSnapshot(
  components: Pick<
    InternalComponents,
    'metrics' | 'logs' | 'storage' | 'processedSnapshotStorage' | 'snapshotStorage' | 'contentDownloader' | 'deployer'
  >,
  options: SnapshotStreamOptions,
  snapshotHash: string,
  servers: Set<string>,
  shouldStopStream: () => boolean
) {
  const logger = components.logs.getLogger('deployEntitiesFromSnapshot')
  const stream = getDeployedEntitiesStreamFromSnapshot(components, options, snapshotHash, servers)
  let snapshotWasCompletelyStreamed = false
  let numberOfStreamedEntities = 0
  let numberOfProcessedEntities = 0
  let snapshotWasMarkedAsProcessed = false
  async function saveIfStreamEndedAndAllEntitiesWereProcessed() {
    // >= (not ===) so an extra markAsDeployed call can't leave the snapshot unmarked forever; the
    // flag (set synchronously before any await) ensures we still mark only once.
    if (
      !snapshotWasMarkedAsProcessed &&
      snapshotWasCompletelyStreamed &&
      numberOfProcessedEntities >= numberOfStreamedEntities
    ) {
      snapshotWasMarkedAsProcessed = true
      await components.processedSnapshotStorage.markSnapshotAsProcessed(snapshotHash)
      components.metrics.increment('dcl_processed_snapshots_total', { state: 'saved' })
    }
  }
  for await (const entity of stream) {
    if (shouldStopStream()) {
      logger.debug('Canceling running sync snapshots stream')
      return
    }
    numberOfStreamedEntities++
    await components.deployer.scheduleEntityDeployment(
      {
        ...entity,
        markAsDeployed: async function () {
          components.metrics.increment('dcl_entities_deployments_processed_total', { source: 'snapshots' })
          numberOfProcessedEntities++
          await saveIfStreamEndedAndAllEntitiesWereProcessed()
        },
        snapshotHash
      },
      entity.servers
    )
  }
  snapshotWasCompletelyStreamed = true
  components.metrics.increment('dcl_processed_snapshots_total', { state: 'stream_end' })
  logger.info('Stream ended.', { snapshotHash })
  await saveIfStreamEndedAndAllEntitiesWereProcessed()
}

/**
 * Decides whether a snapshot should be deployed, given an already-fetched set of processed hashes.
 * Marks the snapshot as processed if a whole replaced-hashes group was already processed.
 */
export async function decideSnapshotDeploymentFromProcessedSet(
  components: Pick<InternalComponents, 'processedSnapshotStorage' | 'snapshotStorage'>,
  processedSnapshots: Set<string>,
  genesisTimestamp: number,
  snapshotHash: string,
  greatestEndTimestamp: number,
  replacedSnapshotHashes: string[][]
): Promise<boolean> {
  const snapshotWasProcessed = processedSnapshots.has(snapshotHash)
  const aReplacedGroupWasProcessed = replacedSnapshotHashes.some(
    (replacedGroup) => replacedGroup.length > 0 && replacedGroup.every((s) => processedSnapshots.has(s))
  )

  if (!snapshotWasProcessed) {
    if (!aReplacedGroupWasProcessed) {
      return greatestEndTimestamp > genesisTimestamp && !(await components.snapshotStorage.has(snapshotHash))
    } else {
      await components.processedSnapshotStorage.markSnapshotAsProcessed(snapshotHash)
    }
  }
  return false
}
