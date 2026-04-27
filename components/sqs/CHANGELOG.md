# @dcl/sqs-component

## 2.2.0

### Minor Changes

- fcef9b9: Extend `IQueueComponent.sendMessage` with a `SendMessageOptions` bag and clean up two small issues on the way:

  - **`options.isRawMessage`** — controls the shape of the SQS `MessageBody`. Default is `false` (the SNS-envelope shape `{ Message: JSON.stringify(message) }`) to preserve the production-tested format existing consumers read. Set to `true` for the single `JSON.stringify(message)` shape that SNS produces with Raw Message Delivery enabled, and that `@dcl/queue-consumer-component` expects.
  - **`options.delaySeconds`** — forwarded to `SendMessageCommand.DelaySeconds` so callers can defer delivery per message. Replaces the previous hardcoded `DelaySeconds: 10`, which was unconditional and undocumented.
  - **`sendMessage` parameter type narrowed** from `any` to `unknown` on the shared interface and both implementations so callers keep type-checking across the boundary.
  - **`@dcl/memory-queue-component`** honors both options: a per-call `isRawMessage` wins over the component-level `wrapInSnsFormat` default (kept for backward compatibility), and `delaySeconds` shifts the message's `visibleAt`.
  - Dropped the redundant `config.getString?.(...)` optional chain in the SQS component (`getString` is always present on `IConfigComponent`).

### Patch Changes

- Updated dependencies [fcef9b9]
  - @dcl/core-commons@0.7.0

## 2.1.0

### Minor Changes

- df22de3: Introduce memory queue component

### Patch Changes

- Updated dependencies [df22de3]
  - @dcl/core-commons@0.6.0

## 2.0.5

### Patch Changes

- c243a86: Add message receive options and new message visibility functions

## 2.0.4

### Patch Changes

- 4a6d070: Add the interfaces dependencies
- Updated dependencies [4a6d070]
  - @dcl/core-commons@0.5.1

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
