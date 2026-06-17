---
"@dcl/snapshots-synchronizer-component": minor
---

Add `@dcl/snapshots-synchronizer-component`: synchronizes Decentraland deployments from catalyst content servers (snapshots bootstrap + pointer-changes streaming) and schedules them on a provided deployer. Extracted from `@dcl/snapshots-fetcher`. Owns an internal request queue and catalyst/snapshots client, depends on `@dcl/content-downloader-component` for snapshot-file downloads, exposes `syncWithServers` plus lower-level `streamFromSnapshot`/`streamFromPointerChanges`, and implements `STOP_COMPONENT`. Carries forward all the hardening (snapshot-response/line log caps, batched processed-snapshot lookup, serialized sync jobs, robust completion check, abortable retry sleep).
