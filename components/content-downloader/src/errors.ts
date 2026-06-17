/**
 * Thrown when a hash is not a plain content address (alphanumeric CID). Guards against using an
 * untrusted hash to build a filesystem path (path traversal).
 */
export class InvalidContentHashError extends Error {
  constructor(hash: unknown) {
    super(`Invalid content hash: ${JSON.stringify(hash)}`)
    this.name = 'InvalidContentHashError'
  }
}

/** Thrown when a downloaded file's hash does not match the expected content address. */
export class HashMismatchError extends Error {
  constructor(expected: string, calculated: string, filename: string) {
    super(`Download error: hashes do not match (expected:${expected} != calculated:${calculated}) for file ${filename}`)
    this.name = 'HashMismatchError'
  }
}

/** Thrown when a hash uses an unknown/unsupported hashing algorithm (not Qm.../ba...). */
export class UnknownHashingAlgorithmError extends Error {
  constructor(hash: string) {
    super(`Unknown hashing algorithm for hash: ${hash}`)
    this.name = 'UnknownHashingAlgorithmError'
  }
}

/** Thrown when a download exceeds the maximum allowed (decompressed) size. */
export class DownloadSizeExceededError extends Error {
  constructor(maxBytes: number) {
    super(`Downloaded file exceeds the maximum allowed size of ${maxBytes} bytes`)
    this.name = 'DownloadSizeExceededError'
  }
}

/** Thrown when a download connection stalls (socket inactivity timeout). */
export class DownloadTimeoutError extends Error {
  constructor(url: string) {
    super(`Timeout while downloading ${url}`)
    this.name = 'DownloadTimeoutError'
  }
}

/** Thrown when a download follows more than the allowed number of redirects. */
export class TooManyRedirectsError extends Error {
  constructor() {
    super('Too many redirects')
    this.name = 'TooManyRedirectsError'
  }
}

/** Thrown when a redirect points to a non-http(s) protocol. */
export class UnsupportedProtocolError extends Error {
  constructor(url: string) {
    super(`Unsupported protocol in URL ${url}`)
    this.name = 'UnsupportedProtocolError'
  }
}

/** Thrown when a content server returns a non-success status. */
export class InvalidResponseError extends Error {
  constructor(url: string, statusCode: number | undefined) {
    super(`Invalid response from ${url} status: ${statusCode}`)
    this.name = 'InvalidResponseError'
  }
}

/** Thrown when an entity file can't be retrieved from storage after being downloaded. */
export class EntityNotRetrievableError extends Error {
  constructor(entityId: string) {
    super(`Entity file ${entityId} could not be retrieved from storage after download`)
    this.name = 'EntityNotRetrievableError'
  }
}
