import { STOP_COMPONENT } from '@well-known-components/interfaces'
import PQueue from 'p-queue'
import * as path from 'path'
import { isValidContentHash, pickRandomServer, saveContentFileToDisk, streamToBuffer } from './download-file'
import { EntityNotRetrievableError, InvalidContentHashError } from './errors'
import { ContentDownloaderComponents, ContentMapping, IContentDownloaderComponent } from './types'

// Default cap on content files downloaded in parallel per entity, so a huge content[] can't exhaust
// sockets / file descriptors. Overridable via downloadEntityAndContentFiles's last argument.
const DEFAULT_ENTITY_FILE_DOWNLOAD_CONCURRENCY = 10

const sleep = (ms: number): Promise<void> => (ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms)))

type EntityMetadata = { type: string; metadata?: any; content?: ContentMapping[] }

/**
 * Creates a content-downloader component.
 *
 * 1. Validates hashes before using them in filesystem paths (prevents path traversal).
 * 2. De-duplicates concurrent downloads of the same file via per-instance state.
 * 3. Tries the provided servers with retries; verifies each file's hash before storing it.
 *
 * @public
 */
export async function createContentDownloaderComponent(
  components: ContentDownloaderComponents
): Promise<IContentDownloaderComponent> {
  const { logs, storage, metrics } = components
  const logger = logs.getLogger('content-downloader')

  // De-dup concurrent downloads of the same file (folder+hash). Instance state, NOT process-global.
  const inFlightDownloads = new Map<string, Promise<void>>()

  async function downloadContentFile(hash: string, finalFileName: string, serverToUse: string): Promise<void> {
    // Storage is keyed by content hash, not the filesystem path; check the hash so a concurrent
    // download targeting a different folder can short-circuit this one.
    if (!(await storage.exist(hash))) {
      const url = new URL(`${serverToUse}/contents/${hash}`).toString()
      await saveContentFileToDisk({ storage, metrics }, url, finalFileName, hash)
    }
  }

  async function downloadJob(
    hashToDownload: string,
    finalFileName: string,
    presentInServers: string[],
    maxRetries: number,
    waitTimeBetweenRetries: number
  ): Promise<void> {
    // cancel early if the file is already downloaded
    if (await storage.exist(hashToDownload)) return

    // Sample the number of candidate servers once per job, not once per retry (which would skew the histogram).
    metrics.observe('dcl_available_servers_histogram', {}, presentInServers.length)

    let retries = 0
    let serversToPickFrom: string[] = presentInServers
    for (;;) {
      retries++
      const serverToUse = pickRandomServer(serversToPickFrom)
      try {
        await downloadContentFile(hashToDownload, finalFileName, serverToUse)
        metrics.observe('dcl_content_download_job_succeed_retries', {}, retries)
        return
      } catch (e: any) {
        if (retries < maxRetries) {
          serversToPickFrom =
            serversToPickFrom.length > 1 ? serversToPickFrom.filter((server) => server !== serverToUse) : serversToPickFrom
          await sleep(waitTimeBetweenRetries)
          continue
        }
        throw e
      }
    }
  }

  async function downloadFileWithRetries(
    hashToDownload: string,
    targetTempFolder: string,
    presentInServers: string[],
    maxRetries: number,
    waitTimeBetweenRetries: number
  ): Promise<void> {
    // Reject untrusted hashes that are not plain content addresses before building a filesystem path.
    if (!isValidContentHash(hashToDownload)) {
      throw new InvalidContentHashError(hashToDownload)
    }

    const finalFileName = path.resolve(targetTempFolder, hashToDownload)

    const existing = inFlightDownloads.get(finalFileName)
    if (existing) {
      return existing
    }

    const job = downloadJob(hashToDownload, finalFileName, presentInServers, maxRetries, waitTimeBetweenRetries)
    inFlightDownloads.set(finalFileName, job)
    try {
      await job
    } finally {
      inFlightDownloads.delete(finalFileName)
    }
  }

  async function downloadProfileAvatars(
    entityMetadata: EntityMetadata,
    presentInServers: string[],
    targetFolder: string,
    maxRetries: number,
    waitTimeBetweenRetries: number,
    concurrency: number
  ): Promise<void> {
    const allAvatars: any[] = entityMetadata.metadata?.avatars ?? []
    const snapshots = allAvatars
      .flatMap((avatar) => Object.values(avatar.avatar.snapshots ?? {}) as string[])
      .filter((snapshot) => !!snapshot)
      .map((snapshot) => {
        const matches = snapshot.match(/^http.*\/content\/contents\/(.*)/)
        return matches ? matches[1] : snapshot
      })
      .filter(
        (snapshot) => !entityMetadata.content || entityMetadata.content.find((content) => content.hash === snapshot) === undefined
      )
    if (snapshots.length > 0) {
      logger.info(`Downloading snapshots ${snapshots} for fixing entity ${JSON.stringify(entityMetadata)}`)
      const queue = new PQueue({ concurrency })
      await Promise.all(
        snapshots.map((snapshot) =>
          queue.add(() =>
            downloadFileWithRetries(snapshot, targetFolder, presentInServers, maxRetries, waitTimeBetweenRetries).catch(() =>
              logger.info(`File ${snapshot} not available for download.`)
            )
          )
        )
      )
    }
  }

  async function downloadEntityAndContentFiles(
    entityId: string,
    presentInServers: string[],
    targetFolder: string,
    maxRetries: number,
    waitTimeBetweenRetries: number,
    contentFilesConcurrency: number = DEFAULT_ENTITY_FILE_DOWNLOAD_CONCURRENCY
  ): Promise<unknown> {
    await downloadFileWithRetries(entityId, targetFolder, presentInServers, maxRetries, waitTimeBetweenRetries)

    const content = await storage.retrieve(entityId)
    if (!content) {
      throw new EntityNotRetrievableError(entityId)
    }

    const stream = await content.asStream()
    const buffer = await streamToBuffer(stream)
    const entityMetadata: EntityMetadata = JSON.parse(buffer.toString())

    if (entityMetadata.type === 'profile' && entityMetadata.metadata) {
      /*
       * Profiles can reference avatar snapshot images that are not included in the content section
       * (e.g. a previous version included them and a later one only references them). Download those.
       */
      await downloadProfileAvatars(
        entityMetadata,
        presentInServers,
        targetFolder,
        maxRetries,
        waitTimeBetweenRetries,
        contentFilesConcurrency
      )
    }

    if (entityMetadata.content) {
      const queue = new PQueue({ concurrency: contentFilesConcurrency })
      await Promise.all(
        entityMetadata.content.map((content) =>
          queue.add(() =>
            downloadFileWithRetries(content.hash, targetFolder, presentInServers, maxRetries, waitTimeBetweenRetries)
          )
        )
      )
    }

    return entityMetadata
  }

  async function stop(): Promise<void> {
    // Let a graceful shutdown wait for in-flight downloads to settle.
    await Promise.allSettled(Array.from(inFlightDownloads.values()))
  }

  return {
    [STOP_COMPONENT]: stop,
    downloadFileWithRetries,
    downloadEntityAndContentFiles
  }
}
