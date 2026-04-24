# @dcl/core-commons

## 0.7.0

### Minor Changes

- fcef9b9: Extend `IQueueComponent.sendMessage` with a `SendMessageOptions` bag and clean up two small issues on the way:

  - **`options.isRawMessage`** — controls the shape of the SQS `MessageBody`. Default is `false` (the SNS-envelope shape `{ Message: JSON.stringify(message) }`) to preserve the production-tested format existing consumers read. Set to `true` for the single `JSON.stringify(message)` shape that SNS produces with Raw Message Delivery enabled, and that `@dcl/queue-consumer-component` expects.
  - **`options.delaySeconds`** — forwarded to `SendMessageCommand.DelaySeconds` so callers can defer delivery per message. Replaces the previous hardcoded `DelaySeconds: 10`, which was unconditional and undocumented.
  - **`sendMessage` parameter type narrowed** from `any` to `unknown` on the shared interface and both implementations so callers keep type-checking across the boundary.
  - **`@dcl/memory-queue-component`** honors both options: a per-call `isRawMessage` wins over the component-level `wrapInSnsFormat` default (kept for backward compatibility), and `delaySeconds` shifts the message's `visibleAt`.
  - Dropped the redundant `config.getString?.(...)` optional chain in the SQS component (`getString` is always present on `IConfigComponent`).

## 0.6.0

### Minor Changes

- df22de3: Add IQueueComponent interface

## 0.5.1

### Patch Changes

- 4a6d070: Add the interfaces dependencies

## 0.5.0

### Minor Changes

- 839b790: Add the acquireLock, releaseLock, tryAcquireLock, and tryReleaseLock functions to the Redis and memory storage components.

## 0.4.0

### Minor Changes

- 31cc8ef: Adds the new hash functions

## 0.3.0

### Minor Changes

- 46ccace: Add ICacheStorageComponent interface

## 0.2.3

### Patch Changes

- 74e1fc1: Adds a README to all packages.

## 0.2.2

### Patch Changes

- ddcdb62: Fix package entrypoint

## 0.2.1

### Patch Changes

- fbca22e: Publish the core-commons package publicly and use it

## 0.2.0

### Minor Changes

- 396f7dc: Initial repository & packages setup
