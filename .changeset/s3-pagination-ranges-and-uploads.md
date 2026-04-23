---
'@dcl/s3-component': minor
---

Harden the S3 component and add a handful of features and bug fixes:

- `listObjects` now paginates with `NextContinuationToken` until `maxKeys` is satisfied, so callers asking for more than 1,000 keys no longer silently receive a capped page.
- `downloadObjectAsStream` accepts `bytes=start-end`, `bytes=start-`, and `bytes=-end` ranges via a single builder, enabling open-ended and suffix ranges.
- `downloadObjectAsJson` returns `null` on empty-string bodies instead of throwing a `SyntaxError`.
- `multipleObjectsExist` processes keys in batches of 50 to avoid socket exhaustion and S3 `SlowDown` throttling on large inputs.
- `uploadObject` now accepts `Readable` streams and an optional `serverSideEncryption` option (with an `AWS_S3_SERVER_SIDE_ENCRYPTION` config fallback for a bucket-wide default).
- Dropped the empty-string key fallback in the list response filter so real objects with missing keys are no longer silently coerced to empty strings and dropped.
- Collapsed duplicate branches in `isNotFoundError`.

**Behavior change** — `listObjects` may now return more than 1,000 keys for callers that previously saw capped results; the extra pages were always missing, but callers that hard-coded a page-size assumption should double-check.
