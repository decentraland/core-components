# @dcl/s3-component

## 2.1.0

### Minor Changes

- 35cfe84: Harden the S3 component and add a handful of features and bug fixes:

  - `listObjects` now paginates with `NextContinuationToken` until `maxKeys` is satisfied, so callers asking for more than 1,000 keys no longer silently receive a capped page.
  - New `listObjectsIterable(prefix?)` async iterator — streams keys across pagination boundaries without buffering the full result set, so callers walking unbounded prefixes don't have to materialize every key in memory up front. Stops fetching additional pages if the consumer breaks out of the loop.
  - `downloadObjectAsStream` accepts `bytes=start-end`, `bytes=start-`, and `bytes=-end` ranges via a single builder, enabling open-ended and suffix ranges.
  - `downloadObjectAsJson` returns `null` on empty-string bodies instead of throwing a `SyntaxError`.
  - `multipleObjectsExist` processes keys in batches of 50 to avoid socket exhaustion and S3 `SlowDown` throttling on large inputs.
  - `uploadObject` now accepts `Readable` streams and an `options` bag carrying `serverSideEncryption` (with an `AWS_S3_SERVER_SIDE_ENCRYPTION` config fallback for a bucket-wide default), `cacheControl`, and `acl` — so callers needing CDN-visible cache semantics or a canned ACL don't have to reach for the raw SDK.
  - New `copyObject(sourceKey, destKey, options?)` — server-side copy for in-place renames and migrations without a download+re-upload round-trip. `sourceBucket` defaults to the component's bucket (same-bucket copy); `metadataDirective: 'REPLACE'` is required to override `contentType` / `cacheControl` on the destination. URL-encodes the source key while preserving its path separators, as AWS expects. Also applies the configured `AWS_S3_SERVER_SIDE_ENCRYPTION` default (or an explicit `options.serverSideEncryption`) so bucket-wide encryption isn't silently dropped on server-side rewrites, mirroring `uploadObject`.
  - `downloadObjectAsJson` now treats whitespace-only bodies the same as empty bodies (returns `null`) instead of throwing a `SyntaxError`, so callers see one consistent "no content" outcome.
  - Dropped the empty-string key fallback in the list response filter so real objects with missing keys are no longer silently coerced to empty strings and dropped.
  - Collapsed duplicate branches in `isNotFoundError`.

  **Behavior change** — `listObjects` may now return more than 1,000 keys for callers that previously saw capped results; the extra pages were always missing, but callers that hard-coded a page-size assumption should double-check.

### Patch Changes

- Updated dependencies [fcef9b9]
  - @dcl/core-commons@0.7.0

## 2.0.2

### Patch Changes

- Updated dependencies [df22de3]
  - @dcl/core-commons@0.6.0

## 2.0.1

### Patch Changes

- 4a6d070: Add the interfaces dependencies
- Updated dependencies [4a6d070]
  - @dcl/core-commons@0.5.1

## 2.0.0

### Major Changes

- 4966be9: Support to download different types of objects and streaming them

## 1.0.1

### Patch Changes

- 4bb9940: Trigger package publishing

## 1.0.0

### Major Changes

- 1ee6b23: S3 Adapter component to manage objects
