---
"@dcl/sqs-component": patch
---

performance: `deleteMessages` and `changeMessagesVisibility` now send their (independent) 10-message batches concurrently with `Promise.all` instead of one `await`ed round-trip after another, so bulk operations over more than 10 handles complete in roughly one round-trip's time instead of N. The SDK's connection pool bounds real parallelism, and a failing batch still rejects as before (with the other batches dispatched rather than skipped).
