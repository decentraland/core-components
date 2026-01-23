# @dcl/cached-fetch-component

Cached fetch component with LRU caching for HTTP requests.

## Installation

```bash
npm install @dcl/cached-fetch-component
```

## Usage

```typescript
import { createCachedFetchComponent } from '@dcl/cached-fetch-component'

const fetch = await createCachedFetchComponent()

// Makes HTTP requests with automatic caching
const response = await fetch.fetch('https://api.example.com/data')
if (response.ok) {
  const data = await response.json()
}

// Subsequent calls to the same URL return cached response
const cachedResponse = await fetch.fetch('https://api.example.com/data')
```

## Features

- LRU (Least Recently Used) cache with configurable size
- Configurable TTL (Time-To-Live) for cached entries
- Configurable cacheable HTTP methods (GET by default)
- Configurable cacheable status codes for error responses
- Implements `IFetchComponent` interface for drop-in replacement
- Transparent: always returns a Response, never throws on HTTP errors
- Only caches successful responses (ok: true) by default
- Error responses can be cached by specifying `cacheableErrorStatusCodes`
- Type-safe with TypeScript

## Configuration Options

The component accepts all [lru-cache options](https://github.com/isaacs/node-lru-cache#options) plus custom options:

```typescript
const fetch = await createCachedFetchComponent(
  { fetchComponent },
  {
    // === Custom options ===
    
    // HTTP methods to cache (default: ['GET'])
    cacheableMethods: ['GET'],
    
    // Additional status codes to cache besides 2xx (default: [])
    // Useful for caching 404 Not Found or 410 Gone responses
    cacheableErrorStatusCodes: [404, 410],
    
    // === LRU Cache options (all optional, see lru-cache docs) ===
    
    // Maximum number of entries in the cache (default: 1000)
    max: 1000,
    
    // TTL in milliseconds (default: 300000 = 5 minutes)
    ttl: 1000 * 60 * 5,
    
    // Any other lru-cache options...
    ttlAutopurge: true,
    updateAgeOnGet: true,
    allowStale: false
  }
)
```

## How It Works

The cached fetch component wraps the standard fetch API and adds LRU caching:

1. Checks if the request method is cacheable (GET by default)
2. Generates a cache key from the URL and method
3. If cached response exists and is not expired, returns cached response
4. If cache miss, performs the network request
5. If response is successful (ok: true) or status is in `cacheableErrorStatusCodes`, caches it
6. Returns the response (always a Response object, never throws on HTTP errors)

Non-cacheable methods (POST, PUT, DELETE, etc.) bypass the cache entirely.

Error responses (4xx, 5xx) are returned but **not cached** by default, so transient errors won't persist.

## Caching Error Responses

Sometimes you want to cache specific error responses, like 404 Not Found:

```typescript
const fetch = await createCachedFetchComponent(
  {},
  { cacheableErrorStatusCodes: [404, 410] }
)

// First call: 404 response is fetched and cached
const response1 = await fetch.fetch('https://api.example.com/missing')
// response1.ok === false, response1.status === 404

// Second call: Returns cached 404 response (no network request)
const response2 = await fetch.fetch('https://api.example.com/missing')
```

This is useful for:
- **404 Not Found**: Cache "does this resource exist?" checks
- **410 Gone**: Cache permanently deleted resources

## Custom Fetch Component

You can provide a custom fetch component:

```typescript
import { createTracedFetcherComponent } from '@dcl/traced-fetch-component'

const tracedFetch = await createTracedFetcherComponent({ tracer })
const cachedFetch = await createCachedFetchComponent(tracedFetch)
```

## node-fetch Compatibility

This component uses `node-fetch` internally for full compatibility with `@well-known-components/fetch-component`.

**Important:** Cached responses are always returned as `node-fetch` Response objects, regardless of what fetch implementation the underlying `fetchComponent` uses. This means:

- If you pass a fetch component that uses native fetch or undici, the responses will still be converted to `node-fetch` Response objects when served from cache
- For most use cases (reading JSON, text, checking status), this is transparent
- If your code relies on `instanceof Response` checks or fetch-implementation-specific methods, be aware of this behavior

## License

MIT
