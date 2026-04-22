---
"@dcl/schema-validator-component": minor
---

Review fixes and API improvements:

- Content-Type matching now parses the media-type portion (before `;`) and exact-matches `application/json`, so `application/json; charset=utf-8` is accepted while `application/jsonfoo` is correctly rejected. Any `+json` structured-suffix content type (e.g. `application/vnd.api+json`, `application/ld+json`, `application/problem+json`) is also accepted.
- Requests with a non-JSON Content-Type now respond with HTTP `415 Unsupported Media Type` instead of `400`.
- Exposed `addSchema` and `validateSchema` as part of the component API for use outside the middleware. `addSchema` is now idempotent: it replaces an existing schema registered under the same key instead of throwing.
- `Validation` is now a discriminated union (`{ valid: true; errors: null } | { valid: false; errors: ErrorObject[] }`) so TypeScript narrows `errors` after checking `valid`. Runtime shape is unchanged.
- Dropped the `removeAdditional: true` Ajv option. The cleaned data was never propagated to `next()`, so the option had no observable effect.
- Tightened the component's generic from `T extends Object` to `T extends object`.
- Fixed the README usage sample (it passed the schema to `createSchemaValidatorComponent` rather than to `withSchemaValidatorMiddleware`) and added notes on body-size handling and duplicate-key behavior.
