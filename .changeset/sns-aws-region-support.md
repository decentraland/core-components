---
'@dcl/sns-component': patch
---

Thread `AWS_REGION` through the SNS client configuration so deploys that rely on an explicit region config key (rather than the AWS SDK's env-var resolution) pick up the right region without extra wiring. Also replaces the `reduce`-based `chunk()` helper with a simple `for` loop and makes `PublishCommandOutput` a type-only import.
