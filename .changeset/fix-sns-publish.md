---
'@dcl/sns-component': minor
---

Fix `publishMessage` sending `StringValue: undefined` when the event had no `subType`, harden `publishMessages` so a single rejected batch no longer discards successful sibling batches (`Promise.allSettled`), and compute failed-event indices directly from the returned `Id` so mismatches can no longer push `undefined` into `failedEvents`.

**Behavior change** — `publishMessages` no longer rejects when a batch hits a network / throttling error. Those events are now reported via `failedEvents` instead. Callers that wrapped `publishMessages` in `try/catch` to detect batch-level failures should inspect `failedEvents` instead.
