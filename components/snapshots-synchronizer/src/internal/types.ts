import { SnapshotsSynchronizerComponents } from '../types'
import { IJobQueue } from './job-queue'

/**
 * The synchronizer's public dependencies plus the internally-owned concurrency queue used for
 * remote-server requests. Passed to the internal modules (client / streams / deploy).
 */
export type InternalComponents = SnapshotsSynchronizerComponents & {
  downloadQueue: IJobQueue
}
