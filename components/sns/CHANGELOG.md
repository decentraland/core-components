# @dcl/sns-component

## 3.1.0

### Minor Changes

- 4f78812: Fix `publishMessage` sending `StringValue: undefined` when the event had no `subType`, harden `publishMessages` so a single rejected batch no longer discards successful sibling batches (`Promise.allSettled`), and compute failed-event indices directly from the returned `Id` so mismatches can no longer push `undefined` into `failedEvents`.

  **Behavior change** — `publishMessages` no longer rejects when a batch hits a network / throttling error. Those events are now reported via `failedEvents` instead. Callers that wrapped `publishMessages` in `try/catch` to detect batch-level failures should inspect `failedEvents` instead.

## 3.0.2

### Patch Changes

- Updated dependencies [df22de3]
  - @dcl/core-commons@0.6.0

## 3.0.1

### Patch Changes

- 4a6d070: Add the interfaces dependencies
- Updated dependencies [4a6d070]
  - @dcl/core-commons@0.5.1

## 3.0.0

### Major Changes

- 0df236f: Adding custom MessageAttributes to SNS Component

### Patch Changes

- 63e623d: Adding validation for existing message attributes (Type & Subtype)

## 2.1.0

### Minor Changes

- 4395f1d: Publish single message

## 2.0.3

### Patch Changes

- Updated dependencies [839b790]
  - @dcl/core-commons@0.5.0

## 2.0.2

### Patch Changes

- Updated dependencies [31cc8ef]
  - @dcl/core-commons@0.4.0

## 2.0.1

### Patch Changes

- Updated dependencies [46ccace]
  - @dcl/core-commons@0.3.0

## 2.0.0

### Major Changes

- 28ea1c4: Introduce memory cache, redis, sqs and sns components
