# @dcl/memory-cache-component

## 2.3.0

### Minor Changes

- 6d35bc9: `createInMemoryCacheComponent` now accepts an optional `InMemoryCacheOptions` bag (`{ max?: number; ttl?: number }`) so callers can override the cap (default `10_000`) and the per-entry default TTL (default `1000 * 60 * 60` ms — one hour). Pass `ttl: 0` to disable TTL entirely so entries live until evicted by the LRU cap. Existing call sites are unchanged: when no options are passed the previous defaults apply.

  Use case: components that need the in-memory cache to behave as a complete mirror of an external store (i.e. no implicit expiration) can now reach for this component instead of rolling a private `Map` / `Set`.

## 2.2.4

### Patch Changes

- Updated dependencies [fcef9b9]
  - @dcl/core-commons@0.7.0

## 2.2.3

### Patch Changes

- Updated dependencies [df22de3]
  - @dcl/core-commons@0.6.0

## 2.2.2

### Patch Changes

- 4a6d070: Add the interfaces dependencies
- Updated dependencies [4a6d070]
  - @dcl/core-commons@0.5.1

## 2.2.1

### Patch Changes

- 8faea85: Updates the LRU cache dependency

## 2.2.0

### Minor Changes

- 839b790: Add the acquireLock, releaseLock, tryAcquireLock, and tryReleaseLock functions to the Redis and memory storage components.

### Patch Changes

- Updated dependencies [839b790]
  - @dcl/core-commons@0.5.0

## 2.1.0

### Minor Changes

- 31cc8ef: Adds the new hash functions

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
