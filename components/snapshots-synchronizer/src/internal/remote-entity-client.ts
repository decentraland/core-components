import { isValidContentHash } from '@dcl/content-downloader-component'
import { PointerChangesSyncDeployment } from '@dcl/schemas'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { metricsDefinitions } from '../metrics'
import { SnapshotMetadata } from '../types'
import { InternalComponents } from './types'
import { contentServerMetricLabels, fetchJson } from './utils'

// Cap how many invalid snapshot entries we log per response, so a server returning many of them
// can't flood the logs.
const MAX_INVALID_SNAPSHOT_LOGS = 100

// Snapshot metadata comes from untrusted servers; keep only entries with the shape we rely on
// (valid content hash + numeric time range) so a malformed response can't break downstream logic.
function isValidSnapshotMetadata(snapshot: any): snapshot is SnapshotMetadata {
  return (
    !!snapshot &&
    typeof snapshot.hash === 'string' &&
    isValidContentHash(snapshot.hash) &&
    !!snapshot.timeRange &&
    typeof snapshot.timeRange.initTimestamp === 'number' &&
    typeof snapshot.timeRange.endTimestamp === 'number' &&
    (snapshot.replacedSnapshotHashes === undefined ||
      (Array.isArray(snapshot.replacedSnapshotHashes) &&
        snapshot.replacedSnapshotHashes.every((hash: any) => isValidContentHash(hash))))
  )
}

export async function getSnapshots(
  components: Pick<InternalComponents, 'logs' | 'fetcher' | 'downloadQueue'>,
  server: string,
  retries: number
): Promise<SnapshotMetadata[]> {
  const logger = components.logs.getLogger('getSnapshots')
  const incrementalSnapshotsUrl = new URL(`${server}/snapshots`).toString()
  const response = await components.downloadQueue.scheduleJobWithRetries(
    () => fetchJson(incrementalSnapshotsUrl, components.fetcher, { timeout: 15000 }),
    retries
  )

  if (!Array.isArray(response)) {
    throw new Error(`Invalid /snapshots response from ${server}: expected an array`)
  }

  const validSnapshots: SnapshotMetadata[] = []
  let invalidSnapshots = 0
  for (const snapshot of response) {
    if (isValidSnapshotMetadata(snapshot)) {
      validSnapshots.push(snapshot)
      continue
    }
    invalidSnapshots++
    if (invalidSnapshots <= MAX_INVALID_SNAPSHOT_LOGS) {
      logger.error('Ignoring invalid snapshot metadata received from server', {
        server,
        snapshot: JSON.stringify(snapshot)
      })
    }
  }
  if (invalidSnapshots > MAX_INVALID_SNAPSHOT_LOGS) {
    logger.error('Ignored additional invalid snapshot metadata entries from server', {
      server,
      total: String(invalidSnapshots)
    })
  }

  // newest first
  return validSnapshots.sort((s1, s2) => s2.timeRange.endTimestamp - s1.timeRange.endTimestamp)
}

export async function* fetchJsonPaginated<T>(
  components: Pick<InternalComponents, 'fetcher' | 'metrics'>,
  url: string,
  selector: (responseBody: any) => T[],
  responseTimeMetric: keyof typeof metricsDefinitions
): AsyncIterable<T> {
  let currentUrl = url
  while (currentUrl) {
    const metricLabels = contentServerMetricLabels(currentUrl)
    const { end: stopTimer } = components.metrics.startTimer(responseTimeMetric)
    const partialHistory: any = await fetchJson(currentUrl, components.fetcher)
    stopTimer({ ...metricLabels })

    for (const elem of selector(partialHistory)) {
      yield elem
    }

    if (partialHistory.pagination) {
      const nextRelative: string | void = partialHistory.pagination.next
      if (!nextRelative) break
      currentUrl = new URL(nextRelative, currentUrl).toString()
    } else {
      break
    }
  }
}

export async function* fetchPointerChanges(
  components: Pick<InternalComponents, 'fetcher' | 'metrics'>,
  server: string,
  fromTimestamp: number,
  logger: ILoggerComponent.ILogger
): AsyncIterable<PointerChangesSyncDeployment> {
  const url = new URL(
    `${server}/pointer-changes?sortingOrder=ASC&sortingField=local_timestamp&from=${encodeURIComponent(fromTimestamp)}`
  ).toString()
  for await (const deployment of fetchJsonPaginated(
    components,
    url,
    ($) => $.deltas,
    'dcl_catalysts_pointer_changes_response_time_seconds'
  )) {
    if (PointerChangesSyncDeployment.validate(deployment)) {
      yield deployment
    } else {
      logger.error('ERROR: Invalid entity deployment from /pointer-changes', {
        deployment: JSON.stringify(deployment),
        error: JSON.stringify(PointerChangesSyncDeployment.validate.errors)
      })
    }
  }
}
