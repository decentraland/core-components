# @dcl/fetch-component

## 1.0.0

### Major Changes

- ecae771: initial release of `@dcl/fetch-component`, moved into core-components from `@well-known-components/fetch-component`. it now uses the default node `fetch` api instead of `cross-fetch` (dropping the browser `buffer` polyfill) and types the component through the shared `IFetchComponent` from `@dcl/core-commons`.

### Patch Changes

- Updated dependencies [ecae771]
  - @dcl/core-commons@0.9.0
