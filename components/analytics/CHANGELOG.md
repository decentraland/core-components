# @dcl/analytics-component

## 1.0.0

### Major Changes

- f57253b: - Apply a request timeout to the Analytics API call to prevent hung fetches. The timeout is read from the optional `ANALYTICS_REQUEST_TIMEOUT` env var; only finite positive numbers are accepted, otherwise the default (10000 ms) is used.
  - Remove the per-event `logger.debug`. It sat outside the try/catch, which meant a failing logger could produce an unhandled rejection through `fireEvent`.
  - **Breaking:** Tighten `sendEvent` / `fireEvent` typing so `body` is bound to the specific event key (`<K extends keyof T>(name: K, body: T[K])`) instead of the union of all event bodies. Export `AnalyticsEventMap = Record<string, Record<string, any>>` as the generic constraint on `IAnalyticsComponent` and `createAnalyticsComponent`, so primitive event bodies are rejected at compile time. Consumers that declared an event map with a primitive body (e.g. `{ page_view: string }`) will see a compile error — in practice these were already broken at runtime because spreading a primitive into the outgoing payload yields `{}`.
  - Rewrite the README to match the current constructor and public API.

### Patch Changes

- Updated dependencies [fcef9b9]
  - @dcl/core-commons@0.7.0

## 0.2.8

### Patch Changes

- Updated dependencies [df22de3]
  - @dcl/core-commons@0.6.0

## 0.2.7

### Patch Changes

- 4a6d070: Add the interfaces dependencies
- Updated dependencies [4a6d070]
  - @dcl/core-commons@0.5.1

## 0.2.6

### Patch Changes

- Updated dependencies [839b790]
  - @dcl/core-commons@0.5.0

## 0.2.5

### Patch Changes

- Updated dependencies [31cc8ef]
  - @dcl/core-commons@0.4.0

## 0.2.4

### Patch Changes

- Updated dependencies [46ccace]
  - @dcl/core-commons@0.3.0

## 0.2.3

### Patch Changes

- 74e1fc1: Adds a README to all packages.
- Updated dependencies [74e1fc1]
  - @dcl/core-commons@0.2.3

## 0.2.2

### Patch Changes

- ddcdb62: Fix package entrypoint
- Updated dependencies [ddcdb62]
  - @dcl/core-commons@0.2.2

## 0.2.1

### Patch Changes

- fbca22e: Publish the core-commons package publicly and use it
- Updated dependencies [fbca22e]
  - @dcl/core-commons@0.2.1

## 0.2.0

### Minor Changes

- 396f7dc: Initial repository & packages setup

### Patch Changes

- Updated dependencies [396f7dc]
  - @dcl/core-commons@0.2.0
