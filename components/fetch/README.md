# @dcl/fetch-component

Fetch component for core components library. It wraps the default Node `fetch`
API with retry, timeout and default-options support, and is meant to be used by
servers running on the default Node runtime.

## Installation

```bash
npm install @dcl/fetch-component
```

## Usage

```typescript
import { createFetchComponent } from '@dcl/fetch-component'

const fetcher = createFetchComponent({
  defaultHeaders: { 'X-Custom': 'value' }
})

const response = await fetcher.fetch('https://api.example.com/data', {
  method: 'GET',
  attempts: 3,
  retryDelay: 100,
  timeout: 5000
})

const data = await response.json()
```

## Features

- Backed by the default Node `fetch` API (no `cross-fetch`/`node-fetch` dependency)
- Automatic retries for idempotent requests (`GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`)
- Retries both retryable status codes and network-level failures (DNS, connection refused/reset, socket hang up)
- Configurable retry delay and timeout per request
- Default headers and default request options shared across calls
- Type-safe through the shared `IFetchComponent` type from `@dcl/core-commons`

## Request options

In addition to the standard `RequestInit` options, `fetch` accepts:

- `attempts` - number of attempts for idempotent requests before giving up
- `retryDelay` - milliseconds to wait between retry attempts
- `timeout` - milliseconds to wait before aborting the request
- `abortController` - an `AbortController` used to abort the request

Non-retryable status codes (`400`, `401`, `403`, `404`) and non-idempotent
methods are never retried. Network-level failures (a rejected `fetch`) are
retried for idempotent methods up to `attempts` times; once the retries are
exhausted the last network error is re-thrown.

## License

Apache-2.0
