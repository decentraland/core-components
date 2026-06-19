---
"@dcl/features-component": major
---

initial release of `@dcl/features-component`, moved into core-components from `@well-known-components/features-component`. it resolves feature flags for an application from env vars and the feature-flags service, and uses the shared `IFetchComponent` type from `@dcl/core-commons`.

the component is now lifecycle-managed: every request to the feature-flags service is bounded by a configurable timeout (`FF_REQUEST_TIMEOUT`); applications registered via `options.apps` are preloaded on start and continuously refreshed in the background (`FF_REFRESH_INTERVAL`), serving reads from an in-memory cache; and concurrent requests for the same application are de-duplicated so callers wait for an in-flight request instead of starting another.
