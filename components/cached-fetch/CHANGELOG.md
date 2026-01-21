# Changelog

## 1.0.0

### Major Changes

- Initial release of the cached fetch component with LRU caching support

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-01-20

### Added

- Initial release of `@dcl/cached-fetch-component`
- LRU cache implementation wrapping `IFetchComponent` interface
- Configurable cache options:
  - `max`: Maximum number of entries in the cache (default: 1000)
  - `ttl`: Time-to-live for cached entries in milliseconds (default: 5 minutes)
  - `cacheableMethods`: HTTP methods to cache (default: `['GET']`)
  - `cacheableErrorStatusCodes`: Additional status codes to cache besides 2xx responses
  - All lru-cache options supported via `Partial<LRUCache.OptionsBase>` (e.g., `ttlAutopurge`, `updateAgeOnGet`, `allowStale`, etc.)
- Transparent Response handling - always returns a Response, never throws on HTTP errors
- Support for custom fetch component injection
- Full compatibility with `IFetchComponent` interface for drop-in replacement
