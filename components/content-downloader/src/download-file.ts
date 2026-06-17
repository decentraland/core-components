import { hashV0, hashV1 } from '@dcl/hashing'
import { IContentStorageComponent } from '@dcl/catalyst-storage'
import { IMetricsComponent } from '@well-known-components/interfaces'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import { pipeline, Readable, Transform } from 'stream'
import { promisify } from 'util'
import * as zlib from 'zlib'
import {
  DownloadSizeExceededError,
  DownloadTimeoutError,
  HashMismatchError,
  InvalidResponseError,
  TooManyRedirectsError,
  UnknownHashingAlgorithmError,
  UnsupportedProtocolError
} from './errors'
import { ContentServerMetricLabels, metricsDefinitions } from './metrics'

const streamPipeline = promisify(pipeline)

type Metrics = IMetricsComponent<keyof typeof metricsDefinitions>
export type DownloadFileComponents = { storage: IContentStorageComponent; metrics: Metrics }

// Stop following redirects after this many hops.
const MAX_REDIRECTS = 10
// Abort a download after this many milliseconds of socket inactivity. Healthy downloads keep the
// socket busy, so this only trips on stalled connections (e.g. a server that stops sending bytes).
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 30_000
// Hard cap on the number of bytes written to disk (after decompression). Protects against gzip
// bombs and otherwise unbounded responses that could exhaust the disk.
const MAX_DOWNLOADED_FILE_SIZE_IN_BYTES = 1024 * 1024 * 1024 // 1 GiB

// Content hashes are IPFS CIDs (base58/base32), hence alphanumeric. Validating against this charset
// before using a hash in a path or storage key prevents path traversal from untrusted hashes.
const VALID_CONTENT_HASH = /^[a-zA-Z0-9]+$/
export function isValidContentHash(hash: string): boolean {
  return typeof hash === 'string' && hash.length > 0 && hash.length <= 128 && VALID_CONTENT_HASH.test(hash)
}

export function pickRandomServer(serversToPickFrom: string[]): string {
  if (serversToPickFrom.length === 0) {
    throw new Error('Cannot pick a server from an empty list of servers')
  }
  // A uniformly-random pick spreads load across servers well enough at scale, without round-robin bookkeeping.
  return serversToPickFrom[Math.floor(Math.random() * serversToPickFrom.length)]
}

export function contentServerMetricLabels(contentServer: string): ContentServerMetricLabels {
  const url = new URL(contentServer)
  return { remote_server: url.origin }
}

export function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = []
    stream.on('error', reject)
    stream.on('data', (data) => buffers.push(data))
    stream.on('end', () => resolve(Buffer.concat(buffers)))
  })
}

async function checkFileExists(file: string): Promise<boolean> {
  return fs.promises
    .access(file, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false)
}

export async function assertHash(filename: string, hash: string): Promise<void> {
  if (hash.startsWith('Qm')) {
    const file = fs.createReadStream(filename)
    try {
      const qmHash = await hashV0(file as any)
      if (qmHash !== hash) {
        throw new HashMismatchError(hash, qmHash, filename)
      }
    } finally {
      file.close()
    }
  } else if (hash.startsWith('ba')) {
    const file = fs.createReadStream(filename)
    try {
      const baHash = await hashV1(file as any)
      if (baHash !== hash) {
        throw new HashMismatchError(hash, baHash, filename)
      }
    } finally {
      file.close()
    }
  } else {
    throw new UnknownHashingAlgorithmError(hash)
  }
}

// Fails the pipeline once more than maxBytes have flowed through it. Placed *after* gunzip so it
// bounds the decompressed size.
function createSizeLimiter(maxBytes: number): Transform {
  let total = 0
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length
      if (total > maxBytes) {
        callback(new DownloadSizeExceededError(maxBytes))
      } else {
        callback(null, chunk)
      }
    }
  })
}

function downloadFile(
  originalUrlString: string,
  metricsLabels: ContentServerMetricLabels,
  metrics: Metrics,
  tmpFileName: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    function requestWithRedirects(redirectedUrl: string, baseUrl: string, redirects: number) {
      // Relative redirects must be resolved against the URL that issued them, not the original URL.
      const url = new URL(redirectedUrl, baseUrl)
      // Only http(s) is supported; reject other schemes (e.g. file:) a redirect could point to.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        reject(new UnsupportedProtocolError(url.toString()))
        return
      }
      const httpModule = url.protocol === 'https:' ? https : http
      if (redirects > MAX_REDIRECTS) {
        reject(new TooManyRedirectsError())
        return
      }

      Object.assign(metricsLabels, contentServerMetricLabels(url.toString()))

      const { end: endTimeMeasurement } = metrics.startTimer('dcl_content_download_duration_seconds', metricsLabels)

      const request = httpModule.get(url.toString(), { headers: { 'accept-encoding': 'gzip' } }, (response) => {
        if ((response.statusCode === 302 || response.statusCode === 301) && response.headers.location) {
          // drain the redirect response so its socket is freed (and its inactivity timer cleared)
          response.resume()
          requestWithRedirects(response.headers.location!, url.toString(), redirects + 1)
          return
        } else if (!response.statusCode || response.statusCode > 300) {
          response.resume()
          reject(new InvalidResponseError(url.toString(), response.statusCode))
          return
        } else {
          const file = fs.createWriteStream(tmpFileName, { emitClose: true })
          const isGzip = response.headers['content-encoding'] === 'gzip'
          const sizeLimiter = createSizeLimiter(MAX_DOWNLOADED_FILE_SIZE_IN_BYTES)

          const pipe = isGzip
            ? streamPipeline(response, zlib.createGunzip(), sizeLimiter, file)
            : streamPipeline(response, sizeLimiter, file)

          pipe
            .then(() => {
              file.close() // close() is async, call cb after close completes.
              metrics.increment('dcl_content_download_bytes_total', metricsLabels, file.bytesWritten)
              endTimeMeasurement()
              resolve()
            })
            .catch((err) => {
              file.close()
              reject(err)
              metrics.increment('dcl_content_download_errors_total', metricsLabels)
              endTimeMeasurement()
            })
        }
      })

      // Reject (instead of hanging forever) when the connection stalls before/while downloading.
      request.setTimeout(DOWNLOAD_INACTIVITY_TIMEOUT_MS, () => {
        request.destroy(new DownloadTimeoutError(url.toString()))
      })

      request.on('error', function (err) {
        reject(err)
        metrics.increment('dcl_content_download_errors_total', metricsLabels)
        endTimeMeasurement()
      })
    }

    requestWithRedirects(originalUrlString, originalUrlString, 0)
  })
}

/**
 * Downloads a file from `originalUrlString` to a temp file, verifies its hash (optional), and moves
 * it into storage keyed by `hash`. The temp file is always cleaned up.
 */
export async function saveContentFileToDisk(
  components: DownloadFileComponents,
  originalUrlString: string,
  destinationFilename: string,
  hash: string,
  checkHash: boolean = true
): Promise<void> {
  let tmpFileName: string
  do {
    tmpFileName = destinationFilename + crypto.randomBytes(16).toString('hex')
  } while (await checkFileExists(tmpFileName))

  const metricsLabels: ContentServerMetricLabels = { remote_server: '' }

  try {
    await downloadFile(originalUrlString, metricsLabels, components.metrics, tmpFileName)

    // make files not executable
    await fs.promises.chmod(tmpFileName, 0o644)

    if (checkHash) {
      try {
        await assertHash(tmpFileName, hash)
      } catch (e) {
        components.metrics.increment('dcl_content_download_hash_errors_total', metricsLabels)
        try {
          if (await checkFileExists(tmpFileName)) {
            await fs.promises.unlink(tmpFileName)
          }
        } catch {}
        throw e
      }
    }

    await components.storage.storeStream(hash, fs.createReadStream(tmpFileName))
  } finally {
    if (await checkFileExists(tmpFileName)) {
      await fs.promises.unlink(tmpFileName)
    }
  }
}
