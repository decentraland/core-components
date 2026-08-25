---
'@dcl/test-helpers': patch
---

Sign the metadata bytes verbatim in `getAuthHeaders`.

The payload parts were each lowercased and then the whole joined string was lowercased again, which folded the serialized metadata after building it. That is the pre-6.0.0 ADR-44 format; `@dcl/crypto-middleware` 6 reconstructs `method:path:timestamp:metadata` with the metadata exactly as `x-identity-metadata` delivers it.

For all-lowercase metadata the two forms are byte-identical, which is why every suite using this helper passed and the mismatch went unnoticed. It only showed up for metadata carrying uppercase, where the helper signed one thing and delivered another — so a service test could not exercise the current signing format at all, and a request that should have been refused by a metadata gate was refused by signature verification instead, for the wrong reason.

Only the trailing fold is removed. The method and path are still lowercased, which is what the signed payload binds.
