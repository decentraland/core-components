# @dcl/features-component

## 1.0.2

### Patch Changes

- f416044: release the feature-flags response body on the error path. `requestFeatureFlags` threw on a non-ok response before consuming the body, leaving an unconsumed undici response that pins its socket and buffers its bytes until GC. The body is now released with `response.body?.cancel()` before throwing.
- f416044: performance: serve cached flags with a single `Map.get` instead of `has` + `get`, and read each variant entry once in `getFeatureVariant`.

## 1.0.1

### Patch Changes

- Updated dependencies [fcf5367]
  - @dcl/core-commons@0.10.1

## 1.0.0

### Major Changes

- 78d7891: initial release of `@dcl/features-component`, moved into core-components from `@well-known-components/features-component`. it resolves feature flags for an application from env vars and the feature-flags service, and uses the shared `IFetchComponent` type from `@dcl/core-commons`.

  the component is now lifecycle-managed: every request to the feature-flags service is bounded by a configurable timeout (`FF_REQUEST_TIMEOUT`); applications registered via `options.apps` are preloaded on start and continuously refreshed in the background (`FF_REFRESH_INTERVAL`), serving reads from an in-memory cache; and concurrent requests for the same application are de-duplicated so callers wait for an in-flight request instead of starting another.
