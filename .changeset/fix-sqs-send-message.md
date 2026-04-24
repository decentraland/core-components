---
'@dcl/sqs-component': minor
'@dcl/memory-queue-component': minor
'@dcl/core-commons': minor
---

Extend `IQueueComponent.sendMessage` with a `SendMessageOptions` bag and clean up two small issues on the way:

- **`options.isRawMessage`** — controls the shape of the SQS `MessageBody`. Default is `false` (the SNS-envelope shape `{ Message: JSON.stringify(message) }`) to preserve the production-tested format existing consumers read. Set to `true` for the single `JSON.stringify(message)` shape that SNS produces with Raw Message Delivery enabled, and that `@dcl/queue-consumer-component` expects.
- **`options.delaySeconds`** — forwarded to `SendMessageCommand.DelaySeconds` so callers can defer delivery per message. Replaces the previous hardcoded `DelaySeconds: 10`, which was unconditional and undocumented.
- **`sendMessage` parameter type narrowed** from `any` to `unknown` on the shared interface and both implementations so callers keep type-checking across the boundary.
- **`@dcl/memory-queue-component`** honors both options: a per-call `isRawMessage` wins over the component-level `wrapInSnsFormat` default (kept for backward compatibility), and `delaySeconds` shifts the message's `visibleAt`.
- Dropped the redundant `config.getString?.(...)` optional chain in the SQS component (`getString` is always present on `IConfigComponent`).
