---
'@dcl/sqs-component': patch
'@dcl/core-commons': patch
---

Fix `sendMessage` double-JSON wrapping that made messages incompatible with `@dcl/queue-consumer-component`, remove the hardcoded 10-second `DelaySeconds`, and drop the redundant optional chain on `config.getString`. Narrow `IQueueComponent.sendMessage` parameter from `any` to `unknown` so callers don't opt out of type checking.
