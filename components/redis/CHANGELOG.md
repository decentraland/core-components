# @dcl/redis-component

## 3.1.1

### Patch Changes

- Updated dependencies [ecae771]
  - @dcl/core-commons@0.9.0

## 3.1.0

### Minor Changes

- f79563a: Add `exists(key)` to `ICacheStorageComponent` and implement it in both Redis and in-memory components.

  `exists` is a presence-only check that avoids transferring the cached value over the wire — useful for set-style caches where callers only care whether they've seen a key before (e.g. a "have we already confirmed this asset exists upstream?" cache). The Redis implementation delegates to `EXISTS`; the in-memory implementation delegates to `LRUCache.has`, which respects expiry and does not bump the LRU recency.

### Patch Changes

- Updated dependencies [f79563a]
  - @dcl/core-commons@0.8.0

## 3.0.2

### Patch Changes

- Updated dependencies [fcef9b9]
  - @dcl/core-commons@0.7.0

## 3.0.1

### Patch Changes

- Updated dependencies [df22de3]
  - @dcl/core-commons@0.6.0

## 3.0.0

### Major Changes

- e9ac70e: Use Redis latest version, which introduces a couple of breaking changes. These breaking changes should not affect the module's interface, but as a precaution, this release will be marked as major.

### Patch Changes

- 4a6d070: Add the interfaces dependencies
- Updated dependencies [4a6d070]
  - @dcl/core-commons@0.5.1

## 2.2.1

### Patch Changes

- f5470e3: Update redis version

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
