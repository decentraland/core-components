---
"@dcl/content-downloader-component": minor
---

Add `@dcl/content-downloader-component`: a streaming content-addressed file downloader (extracted from `@dcl/snapshots-fetcher`). Downloads files by hash from a set of content servers into an `IContentStorageComponent`, with per-instance dedup of concurrent downloads, hash verification, a decompressed-size cap, a socket-inactivity timeout, multi-server failover with retries, content-hash validation (path-traversal guard), and `downloadEntityAndContentFiles`. Implements `STOP_COMPONENT` to drain in-flight downloads.
