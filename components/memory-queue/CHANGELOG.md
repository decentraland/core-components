# Changelog

## 2.0.0

### Major Changes

- df22de3: Introduce memory queue component

### Patch Changes

- Updated dependencies [df22de3]
  - @dcl/core-commons@0.6.0

All notable changes to this project will be documented in this file.

## [1.0.0] - 2024-12-24

### Added

- Initial release of `@dcl/memory-queue-component`
- In-memory queue implementation with `IQueueComponent` interface
- Support for visibility timeout simulation
- Configurable polling delay
- Optional SNS format wrapping for message compatibility
- Full API: `sendMessage`, `receiveMessages`, `deleteMessage`, `deleteMessages`, `changeMessageVisibility`, `changeMessagesVisibility`, `getStatus`
