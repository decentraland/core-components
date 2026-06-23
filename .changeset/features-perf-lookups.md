---
"@dcl/features-component": patch
---

performance: serve cached flags with a single `Map.get` instead of `has` + `get`, and read each variant entry once in `getFeatureVariant`.
