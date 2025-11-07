# @dcl/traced-fetch-component

Traced fetch component for HTTP requests with distributed tracing support.

## Installation

```bash
npm install @dcl/traced-fetch-component
```

## Usage

```typescript
import { createTracedFetcherComponent } from '@dcl/traced-fetch-component'

const fetch = await createTracedFetcherComponent({ tracer })

// Makes HTTP requests with automatic trace propagation
const response = await fetch.fetch('https://api.example.com/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'value' })
})
```

## Features

- Automatic trace propagation via W3C Trace Context headers
- Seamless integration with OpenTelemetry tracer
- Compatible with standard fetch API
- Supports all fetch request options
- Automatic `traceparent` and `tracestate` header injection
- Type-safe with TypeScript

## How It Works

The traced fetch component wraps the standard fetch API and automatically injects distributed tracing headers when a trace span is active:

1. Checks if the current execution is within a trace span
2. If yes, extracts trace context and injects `traceparent` header
3. Optionally includes `tracestate` header if present
4. Forwards all other headers and options as-is
5. Makes the HTTP request with trace propagation enabled

## License

MIT
