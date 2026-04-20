---
'@dcl/queue-consumer-component': patch
---

Restore the `package.json`, `tsconfig.json`, and `jest.config.js` that were accidentally removed in #68, which left the package unbuildable, untestable in CI, and impossible to version. Alongside the restore: make the polling batch size configurable (`batchSize` option, default `10`), abort the in-flight `receiveMessages` long-poll on `stop()` so shutdown no longer waits up to `WaitTimeSeconds`, make the retry backoff actually exponential (1s, 2s, 4s, 8s … capped at 30s) to match the comment, and skip `deleteMessage` when a received message has no `ReceiptHandle` instead of passing `undefined`.
