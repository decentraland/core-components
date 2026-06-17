import { STOP_COMPONENT } from '@well-known-components/interfaces'
import future from 'fp-future'
import PQueue from 'p-queue'
import {
  ISnapshotsSynchronizerComponent,
  PointerChangesStreamOptions,
  SnapshotMetadata,
  SnapshotsSynchronizerComponents,
  SnapshotStreamOptions,
  SynchronizerOptions,
  TimeRange
} from './types'
import {
  decideSnapshotDeploymentFromProcessedSet,
  deployEntitiesFromPointerChanges,
  deployEntitiesFromSnapshot
} from './internal/deploy-entities'
import { createExponentialFallofRetry } from './internal/exponential-falloff-retry'
import { createJobLifecycleManagerComponent } from './internal/job-lifecycle-manager'
import { createJobQueue, createSerialJobRunner } from './internal/jobs'
import { getSnapshots } from './internal/remote-entity-client'
import {
  getDeployedEntitiesStreamFromPointerChanges,
  getDeployedEntitiesStreamFromSnapshot
} from './internal/stream-entities'
import { InternalComponents } from './internal/types'
import { contentServerMetricLabels } from './internal/utils'

/**
 * Creates the snapshots-synchronizer component. It bootstraps the given content servers from
 * snapshots, then keeps syncing from their pointer-changes endpoints, scheduling every deployment
 * on the provided deployer. It owns an internal request queue and uses the injected
 * content-downloader to fetch snapshot files.
 * @public
 */
export async function createSnapshotsSynchronizerComponent(
  publicComponents: SnapshotsSynchronizerComponents,
  options: SynchronizerOptions
): Promise<ISnapshotsSynchronizerComponent> {
  // Internally-owned concurrency-limited queue used for /snapshots requests.
  const downloadQueue = createJobQueue({ autoStart: true, concurrency: 10, timeout: 60000 })
  const components: InternalComponents = { ...publicComponents, downloadQueue }

  const logger = components.logs.getLogger('snapshots-synchronizer')
  const genesisTimestamp = options.fromTimestamp || 0
  const bootstrappingServersFromSnapshots: Set<string> = new Set()
  const bootstrappingServersFromPointerChanges: Set<string> = new Set()
  const syncingServers: Set<string> = new Set()
  const lastEntityTimestampFromSnapshotsByServer: Map<string, number> = new Map()
  // Sync jobs are serialized: only one runs at a time, the rest queue (FIFO).
  const syncJobsRunner = createSerialJobRunner(logger)
  const pointerChangesShiftFix = 20 * 60_000

  let isStopped = false
  const regularSyncFromSnapshotsAfterBootstrapJob = createExponentialFallofRetry(logger, {
    async action() {
      if (isStopped) {
        return
      }
      try {
        await syncFromSnapshots(syncingServers)
      } catch (e: any) {
        // The full error (with stack) is logged by createExponentialFallofRetry; here we add context.
        logger.error(`Error syncing snapshots: ${e?.message ?? JSON.stringify(e)}`)
        throw e
      }
    },
    // every 14 days
    retryTime: 86_400_000 * 14,
    retryTimeExponent: 1
  })
  let firstSyncJobStarted = false
  let snapshotsSyncTimeout: NodeJS.Timeout | undefined

  function pointerChangesStartingTimestamp(server: string): number {
    const lastTimestamp = lastEntityTimestampFromSnapshotsByServer.get(server)
    // Note: a last timestamp of 0 (genesis) is valid, so we must check for undefined explicitly.
    if (lastTimestamp === undefined) {
      throw new Error(
        `Can't start pointer changes stream without last entity timestamp for ${server}. This should never happen.`
      )
    }
    return Math.max(lastTimestamp - pointerChangesShiftFix, 0)
  }

  function increaseLastTimestamp(contentServer: string, ...newTimestamps: number[]) {
    const currentLastTimestamp = lastEntityTimestampFromSnapshotsByServer.get(contentServer) || genesisTimestamp
    lastEntityTimestampFromSnapshotsByServer.set(contentServer, Math.max(currentLastTimestamp, ...newTimestamps))
  }

  function reportServerStateMetric() {
    components.metrics.observe('dcl_bootstrapping_servers', { from: 'snapshots' }, bootstrappingServersFromSnapshots.size)
    components.metrics.observe(
      'dcl_bootstrapping_servers',
      { from: 'pointer-changes' },
      bootstrappingServersFromPointerChanges.size
    )
    components.metrics.observe('dcl_syncing_servers', {}, syncingServers.size)
  }

  async function syncFromSnapshots(serversToSync: Set<string>): Promise<Set<string>> {
    type Snapshot = SnapshotMetadata & { server: string }
    const snapshotsByHash: Map<string, Snapshot[]> = new Map()
    const snapshotLastTimestampByServer: Map<string, number> = new Map()
    // Fetch all servers concurrently; getSnapshots already runs through the concurrency-limited
    // downloadQueue. The synchronous map mutations below can't interleave (no await between them).
    await Promise.all(
      Array.from(serversToSync).map(async (server) => {
        try {
          const snapshots = await getSnapshots(components, server, options.requestMaxRetries)
          // A server may legitimately have no snapshots yet. Math.max() of an empty list is -Infinity,
          // so fall back to the genesis timestamp to keep a sane starting point.
          const lastTimestamp =
            snapshots.length > 0 ? Math.max(...snapshots.map((s) => s.timeRange.endTimestamp)) : genesisTimestamp
          snapshotLastTimestampByServer.set(server, lastTimestamp)
          for (const snapshot of snapshots) {
            const snapshotMetadatas = snapshotsByHash.get(snapshot.hash) ?? []
            snapshotMetadatas.push({ ...snapshot, server })
            snapshotsByHash.set(snapshot.hash, snapshotMetadatas)
          }
        } catch (error) {
          logger.info(`Error getting snapshots from ${server}.`)
        }
      })
    )

    const deploymentsProcessorsQueue = new PQueue({ concurrency: 10, autoStart: false })

    // Resolve all processed snapshot hashes in one storage call instead of one per snapshot.
    const allSnapshotHashesToCheck = new Set<string>()
    for (const [snapshotHash, snapshots] of snapshotsByHash) {
      allSnapshotHashesToCheck.add(snapshotHash)
      for (const snapshot of snapshots) {
        for (const replacedHash of snapshot.replacedSnapshotHashes ?? []) {
          allSnapshotHashesToCheck.add(replacedHash)
        }
      }
    }
    const processedSnapshots =
      allSnapshotHashesToCheck.size > 0
        ? await components.processedSnapshotStorage.filterProcessedSnapshotsFrom(Array.from(allSnapshotHashesToCheck))
        : new Set<string>()

    const timeRangesOfEntitiesToDeploy: TimeRange[] = []
    // Each decision may still hit snapshotStorage; run them with bounded concurrency.
    const shouldProcessChecksQueue = new PQueue({ concurrency: 10 })
    await Promise.all(
      Array.from(snapshotsByHash).map(([snapshotHash, snapshots]) =>
        shouldProcessChecksQueue.add(async () => {
          const replacedSnapshotHashes = snapshots.map((s) => s.replacedSnapshotHashes ?? [])
          const greatestEndTimestamp = Math.max(...snapshots.map((s) => s.timeRange.endTimestamp))
          const shouldProcessSnapshot = await decideSnapshotDeploymentFromProcessedSet(
            components,
            processedSnapshots,
            genesisTimestamp,
            snapshotHash,
            greatestEndTimestamp,
            replacedSnapshotHashes
          )
          if (shouldProcessSnapshot) {
            const servers = new Set(snapshots.map((s) => s.server))
            timeRangesOfEntitiesToDeploy.push(...snapshots.map((s) => s.timeRange))
            deploymentsProcessorsQueue
              .add(async () => {
                await deployEntitiesFromSnapshot(components, options, snapshotHash, servers, () => isStopped)
              })
              .catch((err) => logger.error(err))
          }
        })
      )
    )

    logger.info('Warming up deployer.')
    await components.deployer.prepareForDeploymentsIn(timeRangesOfEntitiesToDeploy)

    logger.info('Starting to deploy entities from snapshots.')
    deploymentsProcessorsQueue.start()

    await deploymentsProcessorsQueue.onIdle()
    logger.info('End deploying entities from snapshots.')

    for (const [server, lastTimestamp] of snapshotLastTimestampByServer) {
      increaseLastTimestamp(server, lastTimestamp)
    }
    return new Set(snapshotLastTimestampByServer.keys())
  }

  async function bootstrapFromSnapshots() {
    logger.debug(`Bootstrapping servers (snapshots): ${Array.from(bootstrappingServersFromSnapshots)}`)
    const syncedServersFromSnapshot = await syncFromSnapshots(bootstrappingServersFromSnapshots)

    for (const bootstrappedServer of syncedServersFromSnapshot) {
      bootstrappingServersFromPointerChanges.add(bootstrappedServer)
      bootstrappingServersFromSnapshots.delete(bootstrappedServer)
    }
    reportServerStateMetric()
  }

  async function bootstrapFromPointerChanges() {
    logger.debug(`Bootstrapping servers (Pointer Changes): ${Array.from(bootstrappingServersFromPointerChanges)}`)
    const pointerChangesBootstrappingJobs: (() => Promise<void>)[] = []
    let minStartingPoint: undefined | number
    for (const bootstrappingServersFromPointerChange of bootstrappingServersFromPointerChanges) {
      const fromTimestamp = pointerChangesStartingTimestamp(bootstrappingServersFromPointerChange)
      minStartingPoint = Math.min(fromTimestamp, minStartingPoint ?? fromTimestamp)
      pointerChangesBootstrappingJobs.push(async () => {
        try {
          const fromTimestamp = pointerChangesStartingTimestamp(bootstrappingServersFromPointerChange)
          await deployEntitiesFromPointerChanges(
            components,
            { ...options, fromTimestamp, pointerChangesWaitTime: 0 },
            bootstrappingServersFromPointerChange,
            () => isStopped,
            increaseLastTimestamp
          )
          syncingServers.add(bootstrappingServersFromPointerChange)
          bootstrappingServersFromPointerChanges.delete(bootstrappingServersFromPointerChange)
        } catch (error) {
          logger.info(`Error bootstrapping from pointer changes for server: ${bootstrappingServersFromPointerChange}`)
        }
      })
    }

    if (minStartingPoint !== undefined) {
      await components.deployer.prepareForDeploymentsIn([{ initTimestamp: minStartingPoint, endTimestamp: Date.now() }])
    }

    if (pointerChangesBootstrappingJobs.length > 0) {
      await Promise.all(pointerChangesBootstrappingJobs.map((job) => job()))
    }

    reportServerStateMetric()
  }

  const deployPointerChangesAfterBootstrapJobManager = createJobLifecycleManagerComponent(components, {
    jobManagerName: 'SynchronizationJobManager',
    createJob(contentServer) {
      const fromTimestamp = lastEntityTimestampFromSnapshotsByServer.get(contentServer)
      if (fromTimestamp === undefined) {
        throw new Error(
          `Can't start pointer changes stream without last entity timestamp for ${contentServer}. This should never happen.`
        )
      }
      const metricsLabels = contentServerMetricLabels(contentServer)
      return createExponentialFallofRetry(logger, {
        async action() {
          if (isStopped) {
            return
          }
          try {
            components.metrics.increment('dcl_deployments_stream_reconnection_count', metricsLabels)
            await deployEntitiesFromPointerChanges(
              components,
              { ...options, fromTimestamp },
              contentServer,
              () => isStopped,
              increaseLastTimestamp
            )
          } catch (e: any) {
            components.metrics.increment('dcl_deployments_stream_failure_count', metricsLabels)
            throw e
          }
        },
        retryTime: options.syncingReconnection.reconnectTime,
        retryTimeExponent: options.syncingReconnection.reconnectRetryTimeExponent ?? 1.1,
        maxInterval: options.syncingReconnection.maxReconnectionTime
      })
    }
  })

  function createSyncJob() {
    const onFirstBootstrapFinishedCallbacks: Array<() => Promise<void>> = []
    let firstBootstrapTryFinished = false
    const syncFinished = future<void>()
    const syncRetry = createExponentialFallofRetry(logger, {
      async action() {
        if (isStopped) {
          return
        }
        logger.info(`Bootstrap (snapshots): ${Array.from(bootstrappingServersFromSnapshots)}`)
        await bootstrapFromSnapshots()

        logger.info(`Bootstrap (pointer-changes): ${Array.from(bootstrappingServersFromPointerChanges)}`)
        await bootstrapFromPointerChanges()

        logger.info('Bootstrap finished')

        if (isStopped) {
          return
        }

        if (!firstBootstrapTryFinished) {
          firstBootstrapTryFinished = true
          if (onFirstBootstrapFinishedCallbacks.length > 0) {
            const runningCallbacks = onFirstBootstrapFinishedCallbacks.map((cb) => cb())
            await Promise.all(runningCallbacks)
          }
        }
        deployPointerChangesAfterBootstrapJobManager.setDesiredJobs(syncingServers)
        logger.info(`Syncing servers: ${Array.from(syncingServers)}`)
        if (bootstrappingServersFromSnapshots.size > 0 || bootstrappingServersFromPointerChanges.size > 0) {
          throw new Error(
            `There are servers that failed to bootstrap. Will try later. Servers: ${JSON.stringify([
              ...bootstrappingServersFromSnapshots,
              ...bootstrappingServersFromPointerChanges
            ])}`
          )
        }
        syncFinished.resolve()
      },
      retryTime: options.bootstrapReconnection.reconnectTime ?? 5000,
      retryTimeExponent: options.bootstrapReconnection.reconnectRetryTimeExponent ?? 1.5,
      maxInterval: options.bootstrapReconnection.maxReconnectionTime ?? 3_600_000,
      exitOnSuccess: true
    })
    return {
      ...syncRetry,
      async onInitialBootstrapFinished(cb: () => Promise<void>) {
        if (!firstBootstrapTryFinished) {
          onFirstBootstrapFinishedCallbacks.push(cb)
        } else {
          await cb()
        }
      },
      async onSyncFinished() {
        await syncFinished
      }
    }
  }

  function removeServersNotToSyncFromStateSet(serversToSync: Set<string>, syncStateSet: Set<string>) {
    for (const syncServerInSomeState of syncStateSet) {
      if (!serversToSync.has(syncServerInSomeState)) {
        syncStateSet.delete(syncServerInSomeState)
      }
    }
  }

  async function syncWithServers(serversToSync: Set<string>) {
    if (isStopped) {
      throw new Error('synchronizer is stopped.')
    }
    for (const serverToSync of serversToSync) {
      if (!syncingServers.has(serverToSync) && !bootstrappingServersFromPointerChanges.has(serverToSync)) {
        bootstrappingServersFromSnapshots.add(serverToSync)
      }
    }

    removeServersNotToSyncFromStateSet(serversToSync, bootstrappingServersFromSnapshots)
    removeServersNotToSyncFromStateSet(serversToSync, bootstrappingServersFromPointerChanges)
    removeServersNotToSyncFromStateSet(serversToSync, syncingServers)

    reportServerStateMetric()

    const newSyncJob = createSyncJob()
    if (!firstSyncJobStarted) {
      firstSyncJobStarted = true
      await newSyncJob.onInitialBootstrapFinished(async () => {
        snapshotsSyncTimeout = setTimeout(async () => await regularSyncFromSnapshotsAfterBootstrapJob.start(), 3_600_000)
      })
    }
    syncJobsRunner.enqueue(newSyncJob)
    return newSyncJob
  }

  async function stop() {
    if (!isStopped) {
      isStopped = true

      await syncJobsRunner.stop()
      syncingServers.clear()
      await deployPointerChangesAfterBootstrapJobManager.stop?.()
      await regularSyncFromSnapshotsAfterBootstrapJob.stop()
      if (snapshotsSyncTimeout) {
        clearTimeout(snapshotsSyncTimeout)
      }
      await downloadQueue.stop?.()
    }
  }

  return {
    [STOP_COMPONENT]: stop,
    syncWithServers,
    streamFromSnapshot: (streamOptions: SnapshotStreamOptions, snapshotHash: string, servers: Set<string>) =>
      getDeployedEntitiesStreamFromSnapshot(components, streamOptions, snapshotHash, servers),
    streamFromPointerChanges: (streamOptions: PointerChangesStreamOptions, contentServer: string) =>
      getDeployedEntitiesStreamFromPointerChanges(components, streamOptions, contentServer)
  }
}
