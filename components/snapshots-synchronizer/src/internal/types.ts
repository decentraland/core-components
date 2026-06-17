import { ITaskQueue } from '@dcl/tasks-component'
import { SnapshotsSynchronizerComponents } from '../types'

/**
 * The synchronizer's public dependencies plus the internally-owned concurrency queue used for
 * remote-server requests. Passed to the internal modules (client / streams / deploy).
 */
export type InternalComponents = SnapshotsSynchronizerComponents & {
  requestQueue: ITaskQueue
}
