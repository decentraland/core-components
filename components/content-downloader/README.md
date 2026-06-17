# @dcl/content-downloader-component

Streaming content-addressed file downloader for Decentraland services. Downloads files (by hash)
from a set of content servers into an `IContentStorageComponent`, with:

- per-instance de-duplication of concurrent downloads of the same file,
- hash verification (CIDv0 `Qm…` / CIDv1 `ba…`) before a file is stored,
- a decompressed-size cap (gzip-bomb protection) and a socket-inactivity timeout,
- multi-server failover with retries,
- content-hash validation to prevent path traversal from untrusted hashes,
- `downloadEntityAndContentFiles` to fetch an entity and all of its content (incl. profile avatars).

## Usage

```ts
import { createContentDownloaderComponent } from '@dcl/content-downloader-component'

const contentDownloader = await createContentDownloaderComponent({ logs, storage, metrics })

// single file
await contentDownloader.downloadFileWithRetries(hash, '/tmp/downloads', servers, 10, 1000)

// an entity + its content files
const entity = await contentDownloader.downloadEntityAndContentFiles(entityId, servers, '/tmp/downloads', 10, 1000)
```

`metrics` must be declared with this package's `metricsDefinitions`. The component implements
`STOP_COMPONENT`, which drains in-flight downloads on shutdown.
