---
'@dcl/queue-consumer-component': minor
---

Restore the `package.json`, `tsconfig.json`, and `jest.config.js` that were accidentally removed in #68, which left the package unbuildable, untestable in CI, and impossible to version. Alongside the restore:

- Add a `batchSize` option (default `10`) to `IQueueConsumerOptions`, replacing the hardcoded poll size.
- Abort the in-flight `receiveMessages` long-poll on `stop()` so shutdown no longer waits up to `WaitTimeSeconds`.
- Replace the mislabeled linear retry with true exponential backoff (1s, 2s, 4s, 8s … capped at 30s) plus full jitter to avoid thundering herd against throttled queues.
- Skip `deleteMessage` when a received message has no `ReceiptHandle` instead of passing `undefined`.
- Isolate `deleteMessage` failures from the receive-failure path so a post-receive delete error no longer triggers receive-level backoff.
