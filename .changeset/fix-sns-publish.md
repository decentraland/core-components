---
'@dcl/sns-component': patch
---

Fix `publishMessage` sending `StringValue: undefined` when the event had no `subType`, harden `publishMessages` so a single rejected batch no longer discards successful sibling batches (`Promise.allSettled`), and compute failed-event indices directly from the returned `Id` so mismatches can no longer push `undefined` into `failedEvents`.
