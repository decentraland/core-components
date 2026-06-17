# @dcl/snapshots-synchronizer-component

Synchronizes Decentraland deployments from catalyst content servers, for indexers and content
mirrors. It bootstraps each server from its snapshots, then keeps syncing from its `/pointer-changes`
endpoint, scheduling every deployment on a provided `IDeployerComponent`. It owns an internal
request queue and the catalyst/snapshots client, and uses `@dcl/content-downloader-component` to
fetch snapshot files.

## Usage

```ts
import { createContentDownloaderComponent } from '@dcl/content-downloader-component'
import { createSnapshotsSynchronizerComponent } from '@dcl/snapshots-synchronizer-component'

const contentDownloader = await createContentDownloaderComponent({ logs, storage, metrics })
const synchronizer = await createSnapshotsSynchronizerComponent(
  { logs, metrics, fetcher, storage, contentDownloader, deployer, snapshotStorage, processedSnapshotStorage },
  {
    tmpDownloadFolder: '/tmp/snapshots',
    requestMaxRetries: 10,
    requestRetryWaitTime: 5000,
    pointerChangesWaitTime: 5000,
    bootstrapReconnection: { reconnectTime: 5000, reconnectRetryTimeExponent: 1.5, maxReconnectionTime: 3_600_000 },
    syncingReconnection: { reconnectTime: 1000, reconnectRetryTimeExponent: 1.2, maxReconnectionTime: 3_600_000 }
  }
)

const job = await synchronizer.syncWithServers(new Set(['https://peer.decentraland.org/content']))
```

The caller provides `deployer` (`IDeployerComponent`), `snapshotStorage` and `processedSnapshotStorage`.
Lower-level `streamFromSnapshot` / `streamFromPointerChanges` methods are exposed for consumers that
drive their own loop. The component implements `STOP_COMPONENT`.
