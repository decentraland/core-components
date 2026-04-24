# @dcl/schema-validator-component

## 0.3.1

### Patch Changes

- Updated dependencies [fcef9b9]
  - @dcl/core-commons@0.7.0

## 0.3.0

### Minor Changes

- f076446: Review fixes and API improvements:

  - Content-Type matching now parses the media-type portion (before `;`) and exact-matches `application/json`, so `application/json; charset=utf-8` is accepted while `application/jsonfoo` is correctly rejected. Any `+json` structured-suffix content type (e.g. `application/vnd.api+json`, `application/ld+json`, `application/problem+json`) is also accepted.
  - Requests with a non-JSON Content-Type now respond with HTTP `415 Unsupported Media Type` instead of `400`.
  - Exposed `addSchema` and `validateSchema` as part of the component API for use outside the middleware. `addSchema` is now idempotent: it replaces an existing schema registered under the same key instead of throwing.
  - `Validation` is now a discriminated union (`{ valid: true; errors: null } | { valid: false; errors: ErrorObject[] }`) so TypeScript narrows `errors` after checking `valid`. Runtime shape is unchanged.
  - Dropped the `removeAdditional: true` Ajv option. The cleaned data was never propagated to `next()`, so the option had no observable effect.
  - Tightened the component's generic from `T extends Object` to `T extends object`.
  - Fixed the README usage sample (it passed the schema to `createSchemaValidatorComponent` rather than to `withSchemaValidatorMiddleware`) and added notes on body-size handling and duplicate-key behavior.

## 0.2.2

### Patch Changes

- Updated dependencies [df22de3]
  - @dcl/core-commons@0.6.0

## 0.2.1

### Patch Changes

- 4a6d070: Add the interfaces dependencies
- Updated dependencies [4a6d070]
  - @dcl/core-commons@0.5.1

## 0.2.0

### Minor Changes

- 064dc5f: Adds as instantiation options the capability to omit the content-type header check.

## 0.1.0

### Minor Changes

- 790c180: Initial build
