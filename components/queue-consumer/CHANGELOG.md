# @dcl/queue-consumer-component

## 3.0.0

### Patch Changes

- Updated dependencies [fcef9b9]
  - @dcl/sqs-component@2.2.0
  - @dcl/core-commons@0.7.0

## 2.1.0

### Minor Changes

- a83c6ae: Restore the `package.json`, `tsconfig.json`, and `jest.config.js` that were accidentally removed in #68, which left the package unbuildable, untestable in CI, and impossible to version. Alongside the restore:

  - Add a `batchSize` option (default `10`) to `IQueueConsumerOptions`, replacing the hardcoded poll size.
  - Abort the in-flight `receiveMessages` long-poll on `stop()` so shutdown no longer waits up to `WaitTimeSeconds`.
  - Replace the mislabeled linear retry with true exponential backoff (1s, 2s, 4s, 8s … capped at 30s) plus full jitter to avoid thundering herd against throttled queues.
  - Skip `deleteMessage` when a received message has no `ReceiptHandle` instead of passing `undefined`.
  - Isolate `deleteMessage` failures from the receive-failure path so a post-receive delete error no longer triggers receive-level backoff.

## 2.0.0

### Patch Changes

- Updated dependencies [df22de3]
- Updated dependencies [df22de3]
  - @dcl/core-commons@0.6.0
  - @dcl/sqs-component@2.1.0

## 1.0.0

### Major Changes

- f930fcd: Change exported function and type names

## 0.1.0

### Minor Changes

- c545f6b: Initial release of the queue-consumer-component

### Patch Changes

- Updated dependencies [c243a86]
  - @dcl/sqs-component@2.0.5
